// サーバー（server/worker.js）を、D1 の代わりに Node の SQLite、Google の鍵の代わりにテスト用の鍵で動かして確かめる。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../server/worker.js';
import { verifyGoogleIdToken, resetKeyCache } from '../server/google.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const ORIGIN = 'https://gridloop.example';
const SCHEMA = ['0001_init.sql', '0002_books.sql', '0003_problem_stats.sql']
  .map((f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')).join('\n');

/** D1 と同じ呼び方（prepare → bind → run/first/all、batch）ができる薄い入れ物。 */
function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(SCHEMA);
  const stmt = (text, args = []) => ({
    bind: (...a) => stmt(text, a),
    async run() { sql.prepare(text).run(...args); return { success: true }; },
    async first() { return sql.prepare(text).get(...args) ?? null; },
    async all() { return { results: sql.prepare(text).all(...args) }; },
    _exec() {
      const s = sql.prepare(text);
      return /^\s*(SELECT|WITH)/i.test(text) ? { results: s.all(...args) } : (s.run(...args), { results: [] });
    },
  });
  return {
    prepare: (text) => stmt(text),
    async batch(list) {
      sql.exec('BEGIN');
      try { const out = list.map((s) => s._exec()); sql.exec('COMMIT'); return out; } catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
    raw: sql,
  };
}

// テスト用の「Google の鍵」と、それで署名した ID トークン
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
async function idToken(claims, { kid = 'k1', key = keyPair.privateKey } = {}) {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'user-1', email: 'a@example.com', email_verified: true, name: 'テスト', ...claims,
  }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

// Google の公開鍵を取りに行く fetch を、テスト用の鍵を返すものに差し替える
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://www.googleapis.com/oauth2/v3/certs')) {
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=600' } });
  }
  return realFetch(url, init);
};

let env;
beforeEach(() => {
  resetKeyCache();
  env = {
    DB: fakeD1(),
    GOOGLE_CLIENT_ID: CLIENT_ID,
    ADMIN_USER_IDS: 'admin-1',
    ASSETS: { fetch: async () => new Response('static') },
  };
});

async function call(path, { method = 'GET', body, cookie, origin = ORIGIN } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const res = await worker.fetch(new Request(ORIGIN + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}

async function loginAs(claims = {}) {
  const r = await call('/api/login', { method: 'POST', body: { credential: await idToken(claims) } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { ...r, cookie: r.setCookie.split(';')[0] };
}

test('静的ファイルはサーバーを通さずに返す', async () => {
  const r = await call('/index.html');
  assert.equal(r.data, 'static');
});

test('設定でクライアント ID を返す', async () => {
  assert.deepEqual((await call('/api/config')).data, { googleClientId: CLIENT_ID });
});

test('ID トークンを確かめてログインし、HttpOnly の Cookie を出す', async () => {
  const r = await loginAs();
  assert.equal(r.data.user.id, 'user-1');
  assert.equal(r.data.needsImport, true);
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /Secure/);
  assert.match(r.setCookie, /SameSite=Lax/);
  const me = await call('/api/me', { cookie: r.cookie });
  assert.equal(me.data.user.name, 'テスト');
  // セッションの token はそのまま DB に置かない
  const raw = r.cookie.split('=')[1];
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(raw).n, 0);
});

test('おかしな ID トークンは断る', async () => {
  const bad = [
    await idToken({ aud: 'someone-else' }),
    await idToken({ iss: 'https://evil.example' }),
    await idToken({ exp: Math.floor(Date.now() / 1000) - 3600 }),
    await idToken({}, { kid: 'unknown' }),
    (await idToken({})).replace(/\.[^.]+$/, '.AAAA'),
    'not-a-token',
  ];
  for (const credential of bad) {
    const r = await call('/api/login', { method: 'POST', body: { credential } });
    assert.equal(r.status, 401, credential.slice(0, 30));
  }
});

test('別の鍵で署名したトークンは断る', async () => {
  const other = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  await assert.rejects(verifyGoogleIdToken(await idToken({}, { key: other.privateKey }), CLIENT_ID), /署名が合いません/);
});

test('ログインしていないとデータは使えない', async () => {
  assert.equal((await call('/api/data')).status, 401);
  assert.equal((await call('/api/library', { method: 'POST', body: { entry: {} } })).status, 401);
});

test('ほかのサイトからの書き込みは断る', async () => {
  const { cookie } = await loginAs();
  const r = await call('/api/library', {
    method: 'POST', cookie, origin: 'https://evil.example',
    body: { entry: { code: '5nAAAA', rows: 5, cols: 5 } },
  });
  assert.equal(r.status, 403);
});

test('問題リストを入れて・外して・読み出す', async () => {
  const { cookie } = await loginAs();
  for (const code of ['5nAAA', '6eBBB']) {
    const r = await call('/api/library', { method: 'POST', cookie, body: { entry: { code, rows: 5, cols: 5, difficulty: 'normal', clueCount: 9, source: 'photo' } } });
    assert.equal(r.status, 200);
  }
  let data = (await call('/api/data', { cookie })).data;
  assert.deepEqual(data.library.map((e) => e.code).sort(), ['5nAAA', '6eBBB']);
  assert.equal(data.library[0].source !== undefined, true);
  await call('/api/library?code=5nAAA', { method: 'DELETE', cookie });
  data = (await call('/api/data', { cookie })).data;
  assert.deepEqual(data.library.map((e) => e.code), ['6eBBB']);
  // 形のおかしい問題コードは入れない
  const bad = await call('/api/library', { method: 'POST', cookie, body: { entry: { code: '<script>' } } });
  assert.equal(bad.status, 400);
});

test('解いた履歴を残し、自己ベストを更新する', async () => {
  const { cookie } = await loginAs();
  const solve = (seconds) => call('/api/history', {
    method: 'POST', cookie, body: { code: '10nABC', rows: 10, cols: 10, difficulty: 'normal', seconds, hints: 1 },
  });
  assert.deepEqual((await solve(300)).data, { ok: true, isBest: true, best: 300 });
  assert.deepEqual((await solve(400)).data, { ok: true, isBest: false, best: 300 });
  assert.deepEqual((await solve(200)).data, { ok: true, isBest: true, best: 200 });
  const data = (await call('/api/data', { cookie })).data;
  assert.equal(data.history.length, 3);
  assert.equal(data.records['10x10:normal'], 200);
  assert.equal(data.history[0].hints, 1);
});

test('途中の盤面は新しいほうだけ残し、解いたら消す', async () => {
  const { cookie } = await loginAs();
  await call('/api/game', { method: 'PUT', cookie, body: { game: { code: '5nAAA', edges: '012', elapsed: 30 }, updatedAt: 2000 } });
  // 古い書き込みが遅れて届いても上書きしない
  await call('/api/game', { method: 'PUT', cookie, body: { game: { code: '5nAAA', edges: '000', elapsed: 10 }, updatedAt: 1000 } });
  let data = (await call('/api/data', { cookie })).data;
  assert.equal(data.game.edges, '012');
  assert.equal(data.game.updatedAt, 2000);
  await call('/api/history', { method: 'POST', cookie, body: { code: '5nAAA', rows: 5, cols: 5, difficulty: 'normal', seconds: 40 } });
  data = (await call('/api/data', { cookie })).data;
  assert.equal(data.game, null);
});

test('端末のデータは最初の 1 回だけ取り込む', async () => {
  const first = await loginAs();
  const payload = {
    library: [{ code: '5nAAA', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9, addedAt: 1 }, { code: 'bad code!' }],
    records: { '5x5:normal': 50, 'evil key': 1 },
    game: { code: '7hCCC', edges: '0', elapsed: 5, updatedAt: 10 },
  };
  assert.equal((await call('/api/import', { method: 'POST', cookie: first.cookie, body: payload })).status, 200);
  const again = await call('/api/import', { method: 'POST', cookie: first.cookie, body: { library: [{ code: '6nZZZ', rows: 6, cols: 6 }] } });
  assert.equal(again.data.skipped, true);
  const data = (await call('/api/data', { cookie: first.cookie })).data;
  assert.deepEqual(data.library.map((e) => e.code), ['5nAAA']);
  assert.deepEqual(data.records, { '5x5:normal': 50 });
  assert.equal(data.game.code, '7hCCC');
  // 2 回目のログインでは取り込みを求めない
  assert.equal((await loginAs()).data.needsImport, false);
});

test('ほかの人のデータは見えない', async () => {
  const a = await loginAs({ sub: 'user-a' });
  await call('/api/library', { method: 'POST', cookie: a.cookie, body: { entry: { code: '5nAAA', rows: 5, cols: 5 } } });
  const b = await loginAs({ sub: 'user-b' });
  assert.deepEqual((await call('/api/data', { cookie: b.cookie })).data.library, []);
});

test('ログアウトするとセッションが使えなくなる', async () => {
  const { cookie } = await loginAs();
  const out = await call('/api/logout', { method: 'POST', cookie, body: {} });
  assert.match(out.setCookie, /Max-Age=0/);
  assert.equal((await call('/api/me', { cookie })).data.user, null);
});

test('管理者だけが問題集を作れる', async () => {
  const user = await loginAs({ sub: 'user-1' });
  assert.equal((await call('/api/me', { cookie: user.cookie })).data.isAdmin, false);
  assert.equal((await call('/api/admin/books', { cookie: user.cookie })).status, 403);
  assert.equal((await call('/api/admin/books', { method: 'POST', cookie: user.cookie, body: { title: 'x' } })).status, 403);
  const admin = await loginAs({ sub: 'admin-1' });
  assert.equal((await call('/api/me', { cookie: admin.cookie })).data.isAdmin, true);
});

test('問題集を作り、問題をまとめて足し、並べ替え・外し・消す', async () => {
  const { cookie } = await loginAs({ sub: 'admin-1' });
  const created = await call('/api/admin/books', { method: 'POST', cookie, body: { title: ' 初級編 ', description: '入門向け' } });
  assert.equal(created.status, 200);
  const id = created.data.book.id;
  assert.equal(created.data.book.title, '初級編');
  assert.equal((await call('/api/admin/books', { method: 'POST', cookie, body: { title: '  ' } })).status, 400);

  const add = await call(`/api/admin/books/${id}/problems`, {
    method: 'POST', cookie, body: { problems: [
      { code: '5nAAA', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9, source: 'a.png' },
      { code: '5eBBB', rows: 5, cols: 5, difficulty: 'easy', clueCount: 11, source: 'b.pdf p.2' },
      { code: '5nAAA', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9 },
    ] },
  });
  assert.deepEqual(add.data, { ok: true, added: 2, skipped: 1 });
  // 同じ問題をもう一度足しても増えない
  const again = await call(`/api/admin/books/${id}/problems`, { method: 'POST', cookie, body: { problems: [{ code: '5eBBB', rows: 5, cols: 5 }, { code: '7hCCC', rows: 7, cols: 7, difficulty: 'hard' }] } });
  assert.deepEqual(again.data, { ok: true, added: 1, skipped: 1 });

  let detail = (await call(`/api/admin/books/${id}`, { cookie })).data;
  assert.deepEqual(detail.problems.map((p) => [p.position, p.code]), [[1, '5nAAA'], [2, '5eBBB'], [3, '7hCCC']]);
  assert.equal(detail.problems[1].source, 'b.pdf p.2');

  // 3 番目を上へ
  await call(`/api/admin/books/${id}/problems/${detail.problems[2].id}`, { method: 'PATCH', cookie, body: { move: 'up' } });
  detail = (await call(`/api/admin/books/${id}`, { cookie })).data;
  assert.deepEqual(detail.problems.map((p) => p.code), ['5nAAA', '7hCCC', '5eBBB']);

  // 1 番目を外すと、番号が詰まる
  await call(`/api/admin/books/${id}/problems/${detail.problems[0].id}`, { method: 'DELETE', cookie });
  detail = (await call(`/api/admin/books/${id}`, { cookie })).data;
  assert.deepEqual(detail.problems.map((p) => [p.position, p.code]), [[1, '7hCCC'], [2, '5eBBB']]);

  await call(`/api/admin/books/${id}`, { method: 'PATCH', cookie, body: { title: '初級編（改）', published: true } });
  const list = (await call('/api/admin/books', { cookie })).data.books;
  assert.equal(list[0].title, '初級編（改）');
  assert.equal(list[0].published, true);
  assert.equal(list[0].count, 2);

  // 形のおかしい問題コードは入れない
  assert.equal((await call(`/api/admin/books/${id}/problems`, { method: 'POST', cookie, body: { problems: [{ code: '<x>' }] } })).status, 400);

  await call(`/api/admin/books/${id}`, { method: 'DELETE', cookie });
  assert.equal((await call(`/api/admin/books/${id}`, { cookie })).status, 404);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM book_problems').get().n, 0);
});

test('問題集の問題に、難易度のほかの目安を持つ', async () => {
  const { cookie } = await loginAs({ sub: 'admin-1' });
  const id = (await call('/api/admin/books', { method: 'POST', cookie, body: { title: '目安' } })).data.book.id;
  const stats = { loopLength: 24, patternShare: 70, freeShare: 55, assumeCount: 2, longestSteps: 9 };
  await call(`/api/admin/books/${id}/problems`, { method: 'POST', cookie, body: { problems: [
    { code: '7hAAA', rows: 7, cols: 7, difficulty: 'hard', clueCount: 20, stats },
    { code: '5nBBB', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9 },
  ] } });
  let { problems } = (await call(`/api/admin/books/${id}`, { cookie })).data;
  assert.deepEqual(problems[0].stats, stats);
  assert.equal(problems[1].stats, null);
  // 目安を持たずに入った問題は、あとから埋められる（おかしな値は丸める）
  await call(`/api/admin/books/${id}/problems/${problems[1].id}`, {
    method: 'PATCH', cookie, body: { stats: { loopLength: 14, patternShare: 140, freeShare: 100, assumeCount: 0, longestSteps: 0 } },
  });
  ({ problems } = (await call(`/api/admin/books/${id}`, { cookie })).data);
  assert.deepEqual(problems[1].stats, { loopLength: 14, patternShare: 100, freeShare: 100, assumeCount: 0, longestSteps: 0 });
});
