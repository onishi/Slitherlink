// サーバー（server/worker.js）を、D1 の代わりに Node の SQLite、Google の鍵の代わりにテスト用の鍵で動かして確かめる。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../server/worker.js';
import { verifyGoogleIdToken, resetKeyCache } from '../server/google.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const ORIGIN = 'https://gridloop.example';
const SCHEMA = ['0001_init.sql', '0002_books.sql', '0003_problem_stats.sql', '0004_coverage_origin.sql', '0005_largest_gap.sql', '0006_book_solved.sql', '0007_generator.sql', '0008_patterns.sql', '0009_problem_meta.sql']
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
      { code: '5eBBB', rows: 5, cols: 5, difficulty: 'easy', clueCount: 11, source: 'b.pdf p.2', meta: '第 2 問\n作者 : 山田' },
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
  assert.equal(detail.problems[1].meta, '第 2 問\n作者 : 山田');
  assert.equal(detail.problems[0].meta, null);

  // 3 番目を上へ
  await call(`/api/admin/books/${id}/problems/${detail.problems[2].id}`, { method: 'PATCH', cookie, body: { move: 'up' } });
  detail = (await call(`/api/admin/books/${id}`, { cookie })).data;
  assert.deepEqual(detail.problems.map((p) => p.code), ['5nAAA', '7hCCC', '5eBBB']);

  // 1 番目を外すと、番号が詰まる
  await call(`/api/admin/books/${id}/problems/${detail.problems[0].id}`, { method: 'DELETE', cookie });
  detail = (await call(`/api/admin/books/${id}`, { cookie })).data;
  assert.deepEqual(detail.problems.map((p) => [p.position, p.code]), [[1, '7hCCC'], [2, '5eBBB']]);

  await call(`/api/admin/books/${id}`, { method: 'PATCH', cookie, body: { title: '初級編（改）', published: true } });
  let list = (await call('/api/admin/books', { cookie })).data.books;
  assert.equal(list[0].title, '初級編（改）');
  assert.equal(list[0].visibility, 'public');
  // 公開のしかたは 3 段階
  await call(`/api/admin/books/${id}`, { method: 'PATCH', cookie, body: { visibility: 'admin' } });
  list = (await call('/api/admin/books', { cookie })).data.books;
  assert.equal(list[0].visibility, 'admin');
  assert.equal(list[0].title, '初級編（改）');
  assert.equal((await call(`/api/admin/books/${id}`, { method: 'PATCH', cookie, body: { visibility: 'all' } })).status, 400);
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
  const stats = { loopLength: 24, patternShare: 70, freeShare: 55, assumeCount: 2, longestSteps: 9, coverage: 81, largestGap: 12.5 };
  await call(`/api/admin/books/${id}/problems`, { method: 'POST', cookie, body: { problems: [
    { code: '7hAAA', rows: 7, cols: 7, difficulty: 'hard', clueCount: 20, stats },
    { code: '5nBBB', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9 },
  ] } });
  let { problems } = (await call(`/api/admin/books/${id}`, { cookie })).data;
  assert.deepEqual(problems[0].stats, stats);
  assert.equal(problems[1].stats, null);
  // 目安を持たずに入った問題は、あとから埋められる（おかしな値は丸める）
  await call(`/api/admin/books/${id}/problems/${problems[1].id}`, {
    method: 'PATCH', cookie, body: { stats: { loopLength: 14, patternShare: 140, freeShare: 100, assumeCount: 0, longestSteps: 0, coverage: 44, largestGap: 56.04 } },
  });
  ({ problems } = (await call(`/api/admin/books/${id}`, { cookie })).data);
  assert.deepEqual(problems[1].stats, { loopLength: 14, patternShare: 100, freeShare: 100, assumeCount: 0, longestSteps: 0, coverage: 44, largestGap: 56 });
  // 最大の空き地を持たない問題は、目安が欠けている（管理画面で計算し直す）
  await call(`/api/admin/books/${id}/problems`, { method: 'POST', cookie, body: { problems: [
    { code: '5nCCC', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9, stats: { ...stats, largestGap: undefined } },
  ] } });
  ({ problems } = (await call(`/api/admin/books/${id}`, { cookie })).data);
  assert.equal(problems[2].stats, null);
});

test('問題の出どころ（スキャン／自動作問）を持ち、出どころごとに目安をくらべられる', async () => {
  const { cookie } = await loginAs({ sub: 'admin-1' });
  const id = (await call('/api/admin/books', { method: 'POST', cookie, body: { title: 'くらべ' } })).data.book.id;
  const st = (patternShare, coverage) => ({ loopLength: 20, patternShare, freeShare: 100, assumeCount: 0, longestSteps: 0, coverage, largestGap: coverage / 10 });
  await call(`/api/admin/books/${id}/problems`, { method: 'POST', cookie, body: { problems: [
    { code: '5nA', rows: 5, cols: 5, difficulty: 'normal', clueCount: 10, origin: 'scan', stats: st(80, 70) },
    { code: '5nB', rows: 5, cols: 5, difficulty: 'hard', clueCount: 5, origin: 'scan', stats: st(60, 90) },
    { code: '5nC', rows: 5, cols: 5, difficulty: 'normal', clueCount: 15, origin: 'generated', stats: st(100, 50) },
    { code: '5nD', rows: 5, cols: 5, difficulty: 'easy', clueCount: 12, origin: 'whatever', stats: st(90, 60) },
  ] } });
  const { problems } = (await call(`/api/admin/books/${id}`, { cookie })).data;
  assert.deepEqual(problems.map((p) => p.origin), ['scan', 'scan', 'generated', null]);
  assert.equal(problems[0].stats.coverage, 70);
  const cmp = (await call('/api/admin/compare', { cookie })).data;
  const scan = cmp.all.find((r) => r.origin === 'scan');
  assert.equal(scan.count, 2);
  assert.equal(scan.patternShare, 70);
  assert.equal(scan.coverage, 80);
  assert.equal(scan.largestGap, 8);
  assert.equal(scan.clueDensity, 30); // (10 + 5) / 2 / 25
  assert.equal(cmp.all.find((r) => r.origin === 'generated').count, 1);
  assert.equal(cmp.all.find((r) => r.origin === 'unknown').count, 1);
  assert.deepEqual(cmp.bySize.map((r) => `${r.origin}:${r.rows}x${r.cols}:${r.count}`), ['generated:5x5:1', 'scan:5x5:2', 'unknown:5x5:1']);
  assert.equal(cmp.levels.filter((r) => r.origin === 'scan').reduce((n, r) => n + r.count, 0), 2);
  // 管理者でなければ見られない
  const user = await loginAs({ sub: 'user-9' });
  assert.equal((await call('/api/admin/compare', { cookie: user.cookie })).status, 403);
});

test('問題集をまたいだ問題の一覧と、問題集どうしのくらべ', async () => {
  const { cookie } = await loginAs({ sub: 'admin-1' });
  const st = (coverage) => ({ loopLength: 20, patternShare: 90, freeShare: 100, assumeCount: 0, longestSteps: 0, coverage, largestGap: 100 - coverage });
  const a = (await call('/api/admin/books', { method: 'POST', cookie, body: { title: 'A' } })).data.book.id;
  const b = (await call('/api/admin/books', { method: 'POST', cookie, body: { title: 'B' } })).data.book.id;
  await call(`/api/admin/books/${a}/problems`, { method: 'POST', cookie, body: { problems: [
    { code: '5nA', rows: 5, cols: 5, difficulty: 'normal', clueCount: 10, origin: 'scan', stats: st(60) },
    { code: '7hA', rows: 7, cols: 7, difficulty: 'hard', clueCount: 20, origin: 'scan', stats: st(80) },
  ] } });
  await call(`/api/admin/books/${b}/problems`, { method: 'POST', cookie, body: { problems: [
    { code: '5eB', rows: 5, cols: 5, difficulty: 'easy', clueCount: 12, origin: 'generated', stats: st(90) },
  ] } });
  const { problems } = (await call('/api/admin/problems', { cookie })).data;
  assert.deepEqual(problems.map((p) => `${p.bookTitle}:${p.position}:${p.code}:${p.coverage}`), ['A:1:5nA:60', 'A:2:7hA:80', 'B:1:5eB:90']);
  const cmp = (await call('/api/admin/compare', { cookie })).data;
  assert.deepEqual(cmp.byBook.map((r) => [r.title, r.count, r.coverage, r.scans, r.generated, r.minCells, r.maxCells]),
    [['A', 2, 70, 2, 0, 25, 49], ['B', 1, 90, 0, 1, 25, 25]]);
  assert.equal(cmp.bookLevels.find((r) => r.bookId === a && r.difficulty === 'hard').count, 1);
  // 1 問の詳細：問題集の中での前後と、問題集の問題数
  const [p1, p2, p3] = problems;
  const one = (await call(`/api/admin/problems/${p1.id}`, { cookie })).data;
  assert.equal(one.problem.code, '5nA');
  assert.equal(one.problem.bookTitle, 'A');
  assert.equal(one.problem.coverage, 60);
  assert.equal(one.problem.largestGap, 40);
  assert.deepEqual([one.bookCount, one.prevId, one.nextId], [2, null, p2.id]);
  const two = (await call(`/api/admin/problems/${p2.id}`, { cookie })).data;
  assert.deepEqual([two.prevId, two.nextId], [p1.id, null]);
  const three = (await call(`/api/admin/problems/${p3.id}`, { cookie })).data;
  assert.deepEqual([three.bookCount, three.prevId, three.nextId], [1, null, null]);
  assert.equal((await call('/api/admin/problems/99999', { cookie })).status, 404);
  assert.equal((await call('/api/admin/problems/abc', { cookie })).status, 404);
  const user = await loginAs({ sub: 'user-9' });
  assert.equal((await call('/api/admin/problems', { cookie: user.cookie })).status, 403);
  assert.equal((await call(`/api/admin/problems/${p1.id}`, { cookie: user.cookie })).status, 403);
});

test('公開した問題集を、ログインした人が遊べて、解いた印が付く', async () => {
  const admin = (await loginAs({ sub: 'admin-1' })).cookie;
  const make = async (title, codes) => {
    const id = (await call('/api/admin/books', { method: 'POST', cookie: admin, body: { title } })).data.book.id;
    await call(`/api/admin/books/${id}/problems`, { method: 'POST', cookie: admin, body: { problems:
      codes.map((code) => ({ code, rows: 5, cols: 5, difficulty: 'normal', clueCount: 10 })) } });
    return id;
  };
  const open = await make('公開', ['5nP1', '5nP2', '5nP3']);
  const hidden = await make('非公開', ['5nH1']);
  await call(`/api/admin/books/${open}`, { method: 'PATCH', cookie: admin, body: { title: '公開', published: true } });

  // ゲストは見られない
  assert.equal((await call('/api/books')).status, 401);
  const { cookie } = await loginAs({ sub: 'player-1' });
  let { books } = (await call('/api/books', { cookie })).data;
  assert.deepEqual(books.map((b) => [b.title, b.count, b.solved]), [['公開', 3, 0]]);
  assert.equal((await call(`/api/books/${hidden}`, { cookie })).status, 404);

  // 問題を解くと（履歴に入れると）、同じコードの問題に印が付く。時間はいちばん速いものを残す
  const solve = (code, seconds) => call('/api/history', { method: 'POST', cookie, body: { code, rows: 5, cols: 5, difficulty: 'normal', seconds, hints: 1 } });
  await solve('5nP2', 90);
  await solve('5nP2', 60);
  await solve('5nP2', 120);
  await solve('5nH1', 30); // 非公開の問題集の問題には付かない
  ({ books } = (await call('/api/books', { cookie })).data);
  assert.equal(books[0].solved, 1);
  const detail = (await call(`/api/books/${open}`, { cookie })).data;
  assert.deepEqual(detail.problems.map((p) => [p.position, p.code, p.solved, p.seconds]),
    [[1, '5nP1', false, null], [2, '5nP2', true, 60], [3, '5nP3', false, null]]);
  // ほかの人には付かない
  const other = (await loginAs({ sub: 'player-2' })).cookie;
  assert.equal((await call('/api/books', { cookie: other })).data.books[0].solved, 0);

  // 問題を外すと印も消える
  const p2 = detail.problems[1].id;
  await call(`/api/admin/books/${open}/problems/${p2}`, { method: 'DELETE', cookie: admin });
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM book_solved').get().n, 0);
});

test('解いた履歴と問題集の印に、ヒントと定石を使った回数が残る（いちばん速いときの回数）', async () => {
  const admin = (await loginAs({ sub: 'admin-1' })).cookie;
  const id = (await call('/api/admin/books', { method: 'POST', cookie: admin, body: { title: '定石' } })).data.book.id;
  await call(`/api/admin/books/${id}/problems`, { method: 'POST', cookie: admin, body: { problems: [{ code: '5nPT1', rows: 5, cols: 5, difficulty: 'normal', clueCount: 10 }] } });
  await call(`/api/admin/books/${id}`, { method: 'PATCH', cookie: admin, body: { visibility: 'public' } });
  const { cookie } = await loginAs({ sub: 'pattern-1' });
  const solve = (seconds, hints, patterns) => call('/api/history', { method: 'POST', cookie, body: { code: '5nPT1', rows: 5, cols: 5, difficulty: 'normal', seconds, hints, patterns } });
  await solve(90, 2, 3);
  await solve(60, 1, 0);
  await solve(120, 0, 5);
  const { history } = (await call('/api/data', { cookie })).data;
  assert.deepEqual(history.map((h) => [h.seconds, h.hints, h.patterns]), [[120, 0, 5], [60, 1, 0], [90, 2, 3]]);
  const p = (await call(`/api/books/${id}`, { cookie })).data.problems[0];
  assert.deepEqual([p.seconds, p.hints, p.patterns], [60, 1, 0]);
});

test('問題集の 1 問の、自分の解いた印を消せる', async () => {
  const admin = (await loginAs({ sub: 'admin-1' })).cookie;
  const id = (await call('/api/admin/books', { method: 'POST', cookie: admin, body: { title: '消す' } })).data.book.id;
  await call(`/api/admin/books/${id}/problems`, { method: 'POST', cookie: admin, body: { problems: [{ code: '5nF1', rows: 5, cols: 5, difficulty: 'normal', clueCount: 10 }] } });
  await call(`/api/admin/books/${id}`, { method: 'PATCH', cookie: admin, body: { visibility: 'public' } });
  const { cookie } = await loginAs({ sub: 'forget-1' });
  const other = (await loginAs({ sub: 'forget-2' })).cookie;
  for (const c of [cookie, other]) {
    await call('/api/history', { method: 'POST', cookie: c, body: { code: '5nF1', rows: 5, cols: 5, difficulty: 'normal', seconds: 50, hints: 0 } });
  }
  const pid = (await call(`/api/books/${id}`, { cookie })).data.problems[0].id;
  assert.equal((await call(`/api/books/${id}/problems/${pid}/solved`, { method: 'DELETE', cookie })).status, 200);
  assert.equal((await call(`/api/books/${id}`, { cookie })).data.problems[0].solved, false);
  // ほかの人の印は残る
  assert.equal((await call(`/api/books/${id}`, { cookie: other })).data.problems[0].solved, true);
  // 別の問題集の番号や、無い問題は 404
  assert.equal((await call(`/api/books/${id + 999}/problems/${pid}/solved`, { method: 'DELETE', cookie })).status, 404);
  assert.equal((await call(`/api/books/${id}/problems/${pid}`, { method: 'DELETE', cookie })).status, 404);
  // ゲストは消せない
  assert.equal((await call(`/api/books/${id}/problems/${pid}/solved`, { method: 'DELETE' })).status, 401);
});

test('管理者のみの問題集は、管理者だけがメニューで遊べる', async () => {
  const admin = (await loginAs({ sub: 'admin-1' })).cookie;
  const id = (await call('/api/admin/books', { method: 'POST', cookie: admin, body: { title: '試し' } })).data.book.id;
  await call(`/api/admin/books/${id}/problems`, { method: 'POST', cookie: admin, body: { problems: [{ code: '5nT1', rows: 5, cols: 5, difficulty: 'normal', clueCount: 10 }] } });
  await call(`/api/admin/books/${id}`, { method: 'PATCH', cookie: admin, body: { visibility: 'admin' } });

  const mine = (await call('/api/books', { cookie: admin })).data.books.find((b) => b.id === id);
  assert.equal(mine.visibility, 'admin');
  assert.equal((await call(`/api/books/${id}`, { cookie: admin })).data.book.visibility, 'admin');
  // 管理者は解いた印も付く
  await call('/api/history', { method: 'POST', cookie: admin, body: { code: '5nT1', rows: 5, cols: 5, difficulty: 'normal', seconds: 40, hints: 0 } });
  assert.equal((await call(`/api/books/${id}`, { cookie: admin })).data.problems[0].solved, true);

  // 管理者でない人には見えない
  const { cookie } = await loginAs({ sub: 'player-9' });
  assert.ok(!(await call('/api/books', { cookie })).data.books.some((b) => b.id === id));
  assert.equal((await call(`/api/books/${id}`, { cookie })).status, 404);
});

test('問題リストに、解いた日時といちばん速い時間も残せる', async () => {
  const { cookie } = await loginAs({ sub: 'list-1' });
  await call('/api/library', { method: 'POST', cookie, body: { entry: { code: '5nLIB', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9, source: 'solved', solvedAt: 1234, seconds: 75 } } });
  await call('/api/library', { method: 'POST', cookie, body: { entry: { code: '5nLIC', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9, source: 'photo', solvedAt: 'x' } } });
  const { library } = (await call('/api/data', { cookie })).data;
  const a = library.find((e) => e.code === '5nLIB');
  assert.deepEqual([a.source, a.solvedAt, a.seconds], ['solved', 1234, 75]);
  const b = library.find((e) => e.code === '5nLIC');
  assert.equal(b.solvedAt, undefined);
});

test('自動作問の問題に、作問ロジックの版を持つ', async () => {
  const { cookie } = await loginAs({ sub: 'admin-1' });
  const id = (await call('/api/admin/books', { method: 'POST', cookie, body: { title: '版' } })).data.book.id;
  await call(`/api/admin/books/${id}/problems`, { method: 'POST', cookie, body: { problems: [
    { code: '5nV1', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9, origin: 'generated', generator: 'teacher-2' },
    { code: '5nV2', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9, origin: 'generated', generator: 'whatever' },
    { code: '5nV3', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9, origin: 'scan', generator: 'random-1' },
  ] } });
  const { problems } = (await call(`/api/admin/books/${id}`, { cookie })).data;
  assert.deepEqual(problems.map((p) => p.generator), ['teacher-2', null, null]);
  const all = (await call('/api/admin/problems', { cookie })).data.problems.filter((p) => p.bookId === id);
  assert.equal(all[0].generator, 'teacher-2');
});

test('すでにある自動作問の問題には、名前から版を付ける（0007）', () => {
  const db = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0002_books.sql', '0003_problem_stats.sql', '0004_coverage_origin.sql', '0005_largest_gap.sql', '0006_book_solved.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  db.exec("INSERT INTO books (id, title, description, published, created_at, updated_at) VALUES (1, 'b', '', 0, 0, 0)");
  const add = db.prepare("INSERT INTO book_problems (book_id, position, code, rows, cols, clue_count, source, created_at, origin) VALUES (1, ?, ?, 5, 5, 9, ?, 0, ?)");
  add.run(1, 'a', 'ランダム 5×5（1 / 3）', 'generated');
  add.run(2, 'b', '教師データ 5×5（2 / 3）', 'generated');
  add.run(3, 'c', 'p1.png', 'scan');
  db.exec(readFileSync(new URL('../migrations/0007_generator.sql', import.meta.url), 'utf8'));
  assert.deepEqual(db.prepare('SELECT generator FROM book_problems ORDER BY position').all().map((r) => r.generator), ['random-1', 'teacher-1', null]);
});

test('id の名前を変える前に保存した教師データの版も、版の番号から読み直して返す', async () => {
  const { cookie } = await loginAs({ sub: 'admin-1' });
  const id = (await call('/api/admin/books', { method: 'POST', cookie, body: { title: '旧い id' } })).data.book.id;
  await call(`/api/admin/books/${id}/problems`, { method: 'POST', cookie, body: { problems: [
    { code: '5nOLD', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9, origin: 'generated', generator: 'teacher-8' },
    { code: '5nRND', rows: 5, cols: 5, difficulty: 'normal', clueCount: 9, origin: 'generated', generator: 'random-1' },
  ] } });
  env.DB.raw.prepare("UPDATE book_problems SET generator = 'old-5' WHERE code = '5nOLD'").run();
  const { problems } = (await call(`/api/admin/books/${id}`, { cookie })).data;
  assert.deepEqual(problems.map((p) => p.generator), ['teacher-5', 'random-1']);
  const one = (await call(`/api/admin/problems/${problems[0].id}`, { cookie })).data.problem;
  assert.equal(one.generator, 'teacher-5');
});
