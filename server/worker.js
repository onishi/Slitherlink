/**
 * Grid Loop のサーバー（Cloudflare Workers）。
 * /api/ だけをここで受け、それ以外は静的ファイル（_site）をそのまま返す。
 *
 * ログインは Google の ID トークンを確かめてから、こちらのセッション（HttpOnly の Cookie）を発行する。
 * ログインした人ごとに、問題リスト・解いた履歴・自己ベスト・途中の盤面を D1 に持つ。
 */

import { verifyGoogleIdToken } from './google.js';

const COOKIE = 'gl_session';
const SESSION_DAYS = 60;
const MAX_LIBRARY = 200;
const MAX_HISTORY = 1000;
const HISTORY_PAGE = 200;
const MAX_CODE = 1400; // 50×50 の盤のコードも入る長さ
const MAX_GAME_BYTES = 64 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'サーバーでエラーが起きました' }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;
  // 書き込みは同じサイトの画面からだけ受ける（ほかのサイトに仕込まれた送信を断る）
  if (method !== 'GET' && method !== 'HEAD') checkSameOrigin(request, url);

  if (pathname === '/api/config' && method === 'GET') {
    return json({ googleClientId: env.GOOGLE_CLIENT_ID || null });
  }
  if (pathname === '/api/login' && method === 'POST') return login(request, env, url);
  if (pathname === '/api/logout' && method === 'POST') return logout(request, env, url);
  if (pathname === '/api/me' && method === 'GET') {
    const user = await currentUser(request, env);
    return json({ user: user && publicUser(user), isAdmin: !!user && isAdmin(user, env) });
  }

  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'ログインしてください');
  const db = env.DB;

  if (pathname.startsWith('/api/admin/')) {
    if (!isAdmin(user, env)) throw new HttpError(403, '管理者だけが使えます');
    return admin(request, db, url);
  }
  if (pathname === '/api/data' && method === 'GET') return json(await loadAll(db, user.id));
  if (pathname === '/api/import' && method === 'POST') return importLocal(db, user, await body(request));
  if (pathname === '/api/library' && method === 'POST') {
    const entry = cleanEntry((await body(request)).entry);
    await putLibrary(db, user.id, entry);
    return json({ ok: true });
  }
  if (pathname === '/api/library' && method === 'DELETE') {
    const code = cleanCode(url.searchParams.get('code'));
    await db.prepare('DELETE FROM library WHERE user_id = ? AND code = ?').bind(user.id, code).run();
    return json({ ok: true });
  }
  if (pathname === '/api/history' && method === 'POST') return addHistory(db, user.id, await body(request));
  if (pathname === '/api/game' && method === 'PUT') {
    const { game, updatedAt } = await body(request);
    const text = JSON.stringify(game ?? null);
    if (!game || typeof game !== 'object' || text.length > MAX_GAME_BYTES) throw new HttpError(400, '途中の盤面の形が違います');
    const at = Number.isFinite(updatedAt) ? Math.floor(updatedAt) : Date.now();
    // 古い書き込みが後から届いても、新しい盤面を上書きしない
    await db.prepare(
      `INSERT INTO games (user_id, game, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET game = excluded.game, updated_at = excluded.updated_at
       WHERE excluded.updated_at >= games.updated_at`,
    ).bind(user.id, text, at).run();
    return json({ ok: true });
  }
  if (pathname === '/api/game' && method === 'DELETE') {
    await db.prepare('DELETE FROM games WHERE user_id = ?').bind(user.id).run();
    return json({ ok: true });
  }
  throw new HttpError(404, 'ありません');
}

function checkSameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) throw new HttpError(403, 'ほかのサイトからは使えません');
  const type = request.headers.get('content-type') || '';
  if (request.method !== 'DELETE' && !type.startsWith('application/json')) {
    throw new HttpError(415, 'JSON で送ってください');
  }
}

async function body(request) {
  try { return (await request.json()) ?? {}; } catch { throw new HttpError(400, 'JSON の形が違います'); }
}

/* ---------------- ログイン ---------------- */

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function cookieOf(request) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === COOKIE) return part.slice(i + 1);
  }
  return null;
}

function sessionCookie(url, token, maxAge) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, picture: u.picture });

async function currentUser(request, env) {
  const token = cookieOf(request);
  if (!token || !env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), Date.now()).first();
  return row ?? null;
}

async function login(request, env, url) {
  const { credential } = await body(request);
  let profile;
  try {
    profile = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
  } catch (err) {
    throw new HttpError(401, `ログインできませんでした（${err.message}）`);
  }
  const db = env.DB;
  const now = Date.now();
  await db.prepare(
    `INSERT INTO users (id, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture`,
  ).bind(profile.sub, profile.email, profile.name, profile.picture, now).run();
  const token = randomToken();
  const maxAge = SESSION_DAYS * 24 * 3600;
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').bind(profile.sub, now),
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), profile.sub, now, now + maxAge * 1000),
  ]);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(profile.sub).first();
  return json(
    { user: publicUser(user), needsImport: user.imported_at == null },
    200,
    { 'set-cookie': sessionCookie(url, token, maxAge) },
  );
}

async function logout(request, env, url) {
  const token = cookieOf(request);
  if (token && env.DB) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(url, '', 0) });
}

/* ---------------- データ ---------------- */

function cleanCode(code) {
  if (typeof code !== 'string' || !code || code.length > MAX_CODE || !/^[0-9A-Za-z._~-]+$/.test(code)) {
    throw new HttpError(400, '問題コードの形が違います');
  }
  return code;
}

const int = (v, lo, hi) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
};
const shortText = (v) => (typeof v === 'string' ? v.slice(0, 20) : null);

function cleanEntry(e) {
  if (!e || typeof e !== 'object') throw new HttpError(400, '問題の形が違います');
  return {
    code: cleanCode(e.code),
    rows: int(e.rows, 2, 60),
    cols: int(e.cols, 2, 60),
    difficulty: shortText(e.difficulty),
    clueCount: int(e.clueCount, 0, 3600),
    source: shortText(e.source),
    addedAt: Number.isFinite(e.addedAt) ? Math.floor(e.addedAt) : Date.now(),
  };
}

async function putLibrary(db, userId, entry) {
  const { code, addedAt, ...rest } = entry;
  await db.batch([
    db.prepare(
      `INSERT INTO library (user_id, code, entry, added_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, code) DO UPDATE SET entry = excluded.entry, added_at = excluded.added_at`,
    ).bind(userId, code, JSON.stringify(rest), addedAt),
    // 多すぎる分は古いものから落とす
    db.prepare(
      `DELETE FROM library WHERE user_id = ? AND code NOT IN
       (SELECT code FROM library WHERE user_id = ? ORDER BY added_at DESC LIMIT ${MAX_LIBRARY})`,
    ).bind(userId, userId),
  ]);
}

async function loadAll(db, userId) {
  const [lib, hist, recs, game] = await db.batch([
    db.prepare('SELECT code, entry, added_at FROM library WHERE user_id = ? ORDER BY added_at DESC').bind(userId),
    db.prepare(
      `SELECT code, rows, cols, difficulty, seconds, hints, solved_at FROM history
       WHERE user_id = ? ORDER BY solved_at DESC LIMIT ${HISTORY_PAGE}`,
    ).bind(userId),
    db.prepare('SELECT key, seconds FROM records WHERE user_id = ?').bind(userId),
    db.prepare('SELECT game, updated_at FROM games WHERE user_id = ?').bind(userId),
  ]);
  const g = game.results[0];
  return {
    library: lib.results.map((r) => ({ ...JSON.parse(r.entry), code: r.code, addedAt: r.added_at })),
    history: hist.results.map((r) => ({
      code: r.code, rows: r.rows, cols: r.cols, difficulty: r.difficulty,
      seconds: r.seconds, hints: r.hints, solvedAt: r.solved_at,
    })),
    records: Object.fromEntries(recs.results.map((r) => [r.key, r.seconds])),
    game: g ? { ...JSON.parse(g.game), updatedAt: g.updated_at } : null,
  };
}

function recordStatement(db, userId, key, seconds) {
  return db.prepare(
    `INSERT INTO records (user_id, key, seconds) VALUES (?, ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET seconds = MIN(records.seconds, excluded.seconds)`,
  ).bind(userId, key, seconds);
}

async function addHistory(db, userId, b) {
  const code = cleanCode(b.code);
  const rows = int(b.rows, 2, 60);
  const cols = int(b.cols, 2, 60);
  const difficulty = shortText(b.difficulty);
  const seconds = int(b.seconds, 0, 10 * 24 * 3600);
  const hints = int(b.hints, 0, 100000);
  const key = `${rows}x${cols}:${difficulty}`;
  const before = await db.prepare('SELECT seconds FROM records WHERE user_id = ? AND key = ?').bind(userId, key).first();
  await db.batch([
    db.prepare(
      'INSERT INTO history (user_id, code, rows, cols, difficulty, seconds, hints, solved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(userId, code, rows, cols, difficulty, seconds, hints, Date.now()),
    recordStatement(db, userId, key, seconds),
    db.prepare(
      `DELETE FROM history WHERE user_id = ? AND id NOT IN
       (SELECT id FROM history WHERE user_id = ? ORDER BY solved_at DESC LIMIT ${MAX_HISTORY})`,
    ).bind(userId, userId),
    // 解き終えた問題の途中の盤面は要らない
    db.prepare('DELETE FROM games WHERE user_id = ?').bind(userId),
  ]);
  const isBest = before == null || seconds < before.seconds;
  return json({ ok: true, isBest, best: isBest ? seconds : before.seconds });
}

/** 初めてログインしたとき、その端末にあった問題リスト・自己ベスト・途中の盤面をアカウントに入れる。 */
async function importLocal(db, user, b) {
  const fresh = await db.prepare('SELECT imported_at FROM users WHERE id = ?').bind(user.id).first();
  if (fresh?.imported_at != null) return json({ ok: true, skipped: true });
  const statements = [];
  const library = Array.isArray(b.library) ? b.library.slice(0, MAX_LIBRARY) : [];
  for (const raw of library) {
    let entry;
    try { entry = cleanEntry(raw); } catch { continue; }
    const { code, addedAt, ...rest } = entry;
    statements.push(db.prepare(
      `INSERT INTO library (user_id, code, entry, added_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, code) DO NOTHING`,
    ).bind(user.id, code, JSON.stringify(rest), addedAt));
  }
  const records = b.records && typeof b.records === 'object' ? Object.entries(b.records).slice(0, 500) : [];
  for (const [key, seconds] of records) {
    if (!/^\d{1,2}x\d{1,2}:[a-z]{1,12}$/.test(key) || !Number.isFinite(seconds)) continue;
    statements.push(recordStatement(db, user.id, key, int(seconds, 0, 10 * 24 * 3600)));
  }
  if (b.game && typeof b.game === 'object' && JSON.stringify(b.game).length <= MAX_GAME_BYTES) {
    const at = Number.isFinite(b.game.updatedAt) ? Math.floor(b.game.updatedAt) : Date.now();
    statements.push(db.prepare(
      `INSERT INTO games (user_id, game, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET game = excluded.game, updated_at = excluded.updated_at
       WHERE excluded.updated_at > games.updated_at`,
    ).bind(user.id, JSON.stringify(b.game), at));
  }
  statements.push(db.prepare('UPDATE users SET imported_at = ? WHERE id = ?').bind(Date.now(), user.id));
  await db.batch(statements);
  return json({ ok: true, imported: { library: library.length, records: records.length, game: !!b.game } });
}

/* ---------------- 管理画面：問題集 ---------------- */

/** 管理者か。ADMIN_USER_IDS（Google のアカウント ID）か ADMIN_EMAILS（確認済みのメール）に入っている人。 */
function isAdmin(user, env) {
  const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (list(env.ADMIN_USER_IDS).includes(user.id)) return true;
  return !!user.email && list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()).includes(user.email.toLowerCase());
}

const MAX_BOOK_PROBLEMS = 1000;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function bookRow(r) {
  return {
    id: r.id, title: r.title, description: r.description, published: !!r.published,
    count: r.count ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

async function admin(request, db, url) {
  const method = request.method;
  const parts = url.pathname.split('/').filter(Boolean).slice(2); // ['books', id, 'problems', pid]
  if (parts[0] === 'compare' && parts.length === 1 && method === 'GET') return compareOrigins(db);
  if (parts[0] === 'problems' && parts.length === 1 && method === 'GET') return allProblems(db);
  if (parts[0] === 'problems' && parts.length === 2 && method === 'GET') return oneProblem(db, Number(parts[1]));
  if (parts[0] !== 'books') throw new HttpError(404, 'ありません');
  const now = Date.now();

  if (parts.length === 1 && method === 'GET') {
    const { results } = await db.prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM book_problems p WHERE p.book_id = b.id) AS count
       FROM books b ORDER BY b.created_at DESC`,
    ).all();
    return json({ books: results.map(bookRow) });
  }
  if (parts.length === 1 && method === 'POST') {
    const b = await body(request);
    const title = text(b.title, 100);
    if (!title) throw new HttpError(400, '問題集の名前を入れてください');
    const row = await db.prepare(
      'INSERT INTO books (title, description, published, created_at, updated_at) VALUES (?, ?, 0, ?, ?) RETURNING *',
    ).bind(title, text(b.description, 2000), now, now).first();
    return json({ book: bookRow({ ...row, count: 0 }) });
  }

  const id = Number(parts[1]);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'ありません');
  const book = await db.prepare('SELECT * FROM books WHERE id = ?').bind(id).first();
  if (!book) throw new HttpError(404, 'その問題集はありません');

  if (parts.length === 2 && method === 'GET') {
    const { results } = await db.prepare(
      'SELECT * FROM book_problems WHERE book_id = ? ORDER BY position',
    ).bind(id).all();
    return json({
      book: bookRow({ ...book, count: results.length }),
      problems: results.map((p) => ({
        id: p.id, position: p.position, code: p.code, rows: p.rows, cols: p.cols,
        difficulty: p.difficulty, clueCount: p.clue_count, source: p.source, createdAt: p.created_at,
        origin: p.origin,
        // 目安がそろっていないもの（行き渡り率・最大の空き地を足す前に入れた問題など）は、管理画面で計算し直して埋める
        stats: p.pattern_share == null || p.coverage == null || p.largest_gap == null ? null : {
          loopLength: p.loop_length, patternShare: p.pattern_share, freeShare: p.free_share,
          assumeCount: p.assume_count, longestSteps: p.longest_steps, coverage: p.coverage, largestGap: p.largest_gap,
        },
      })),
    });
  }
  if (parts.length === 2 && method === 'PATCH') {
    const b = await body(request);
    const title = b.title === undefined ? book.title : text(b.title, 100);
    if (!title) throw new HttpError(400, '問題集の名前を入れてください');
    const description = b.description === undefined ? book.description : text(b.description, 2000);
    const published = b.published === undefined ? book.published : (b.published ? 1 : 0);
    await db.prepare('UPDATE books SET title = ?, description = ?, published = ?, updated_at = ? WHERE id = ?')
      .bind(title, description, published, now, id).run();
    return json({ ok: true });
  }
  if (parts.length === 2 && method === 'DELETE') {
    await db.batch([
      db.prepare('DELETE FROM book_problems WHERE book_id = ?').bind(id),
      db.prepare('DELETE FROM books WHERE id = ?').bind(id),
    ]);
    return json({ ok: true });
  }

  if (parts[2] !== 'problems') throw new HttpError(404, 'ありません');

  // まとめて足す（取り込んで確かめた問題）。同じ問題がもうあれば飛ばす
  if (parts.length === 3 && method === 'POST') {
    const b = await body(request);
    const list = Array.isArray(b.problems) ? b.problems : [];
    if (!list.length) throw new HttpError(400, '足す問題がありません');
    const { n, last } = await db.prepare(
      'SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS last FROM book_problems WHERE book_id = ?',
    ).bind(id).first();
    if (n + list.length > MAX_BOOK_PROBLEMS) throw new HttpError(400, `1 つの問題集に入れられるのは ${MAX_BOOK_PROBLEMS} 問までです`);
    const statements = [];
    let pos = last;
    for (const raw of list) {
      const e = cleanEntry({ ...raw, source: undefined });
      const st = cleanStats(raw.stats);
      pos += 1;
      statements.push(db.prepare(
        `INSERT INTO book_problems (book_id, position, code, rows, cols, difficulty, clue_count, source, created_at,
           loop_length, pattern_share, free_share, assume_count, longest_steps, coverage, largest_gap, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (book_id, code) DO NOTHING`,
      ).bind(id, pos, e.code, e.rows, e.cols, e.difficulty, e.clueCount, text(raw.source, 200) || null, now,
        st.loopLength, st.patternShare, st.freeShare, st.assumeCount, st.longestSteps, st.coverage, st.largestGap, cleanOrigin(raw.origin)));
    }
    statements.push(db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').bind(now, id));
    await db.batch(statements);
    // 飛ばした分で番号が空かないよう、詰め直す
    await renumber(db, id);
    const { count } = await db.prepare('SELECT COUNT(*) AS count FROM book_problems WHERE book_id = ?').bind(id).first();
    return json({ ok: true, added: count - n, skipped: list.length - (count - n) });
  }

  const pid = Number(parts[3]);
  if (parts.length !== 4 || !Number.isInteger(pid)) throw new HttpError(404, 'ありません');
  if (method === 'DELETE') {
    await db.prepare('DELETE FROM book_problems WHERE id = ? AND book_id = ?').bind(pid, id).run();
    await renumber(db, id);
    return json({ ok: true });
  }
  // 順番を 1 つ上げる・下げる／目安（stats）を入れる（目安を持たずに登録した問題をあとで埋める）
  if (method === 'PATCH') {
    const { move, stats, difficulty } = await body(request);
    if (stats) {
      const st = cleanStats(stats);
      if (st.patternShare == null) throw new HttpError(400, '目安の形が違います');
      await db.prepare(
        `UPDATE book_problems SET loop_length = ?, pattern_share = ?, free_share = ?, assume_count = ?, longest_steps = ?,
           coverage = ?, largest_gap = ?, difficulty = COALESCE(?, difficulty) WHERE id = ? AND book_id = ?`,
      ).bind(st.loopLength, st.patternShare, st.freeShare, st.assumeCount, st.longestSteps, st.coverage, st.largestGap,
        shortText(difficulty), pid, id).run();
      return json({ ok: true });
    }
    const cur = await db.prepare('SELECT position FROM book_problems WHERE id = ? AND book_id = ?').bind(pid, id).first();
    if (!cur) throw new HttpError(404, 'その問題はありません');
    const target = cur.position + (move === 'up' ? -1 : 1);
    const other = await db.prepare('SELECT id FROM book_problems WHERE book_id = ? AND position = ?').bind(id, target).first();
    if (other) {
      await db.batch([
        db.prepare('UPDATE book_problems SET position = ? WHERE id = ?').bind(target, pid),
        db.prepare('UPDATE book_problems SET position = ? WHERE id = ?').bind(cur.position, other.id),
      ]);
    }
    return json({ ok: true });
  }
  throw new HttpError(404, 'ありません');
}

/**
 * 出どころ（スキャン／自動作問）ごとに、目安の平均をくらべる。盤の大きさで目安が変わるので、大きさごとにも分ける。
 * 数字の個数と線の本数は、マス数で割った割合（%）にしてくらべやすくする。
 */
async function compareOrigins(db) {
  const metrics = `COUNT(*) AS count,
    AVG(100.0 * clue_count / (rows * cols)) AS clueDensity,
    AVG(100.0 * loop_length / (rows * cols)) AS loopPerCell,
    AVG(pattern_share) AS patternShare, AVG(free_share) AS freeShare,
    AVG(assume_count) AS assumeCount, AVG(longest_steps) AS longestSteps, AVG(coverage) AS coverage,
    AVG(largest_gap) AS largestGap`;
  const [all, bySize, levels, byBook, bookLevels] = await db.batch([
    db.prepare(`SELECT COALESCE(origin, 'unknown') AS origin, ${metrics} FROM book_problems GROUP BY 1 ORDER BY 1`),
    db.prepare(`SELECT COALESCE(origin, 'unknown') AS origin, rows, cols, ${metrics} FROM book_problems
      GROUP BY 1, rows, cols ORDER BY rows * cols, rows, 1`),
    db.prepare(`SELECT COALESCE(origin, 'unknown') AS origin, difficulty, COUNT(*) AS count FROM book_problems GROUP BY 1, 2`),
    // 問題集どうしをくらべる
    db.prepare(`SELECT b.id AS bookId, b.title, COUNT(*) AS count,
      AVG(100.0 * p.clue_count / (p.rows * p.cols)) AS clueDensity,
      AVG(100.0 * p.loop_length / (p.rows * p.cols)) AS loopPerCell,
      AVG(p.pattern_share) AS patternShare, AVG(p.free_share) AS freeShare,
      AVG(p.assume_count) AS assumeCount, AVG(p.longest_steps) AS longestSteps, AVG(p.coverage) AS coverage,
      AVG(p.largest_gap) AS largestGap,
      SUM(p.origin = 'scan') AS scans, SUM(p.origin = 'generated') AS generated,
      MIN(p.rows * p.cols) AS minCells, MAX(p.rows * p.cols) AS maxCells
      FROM books b JOIN book_problems p ON p.book_id = b.id GROUP BY b.id ORDER BY b.created_at, b.id`),
    db.prepare('SELECT book_id AS bookId, difficulty, COUNT(*) AS count FROM book_problems GROUP BY 1, 2'),
  ]);
  return json({
    all: all.results, bySize: bySize.results, levels: levels.results,
    byBook: byBook.results, bookLevels: bookLevels.results,
  });
}

/** 問題集をまたいだ問題の一覧（絞り込みと並べ替えは管理画面でする）。 */
/** 問題集をまたいだ一覧・1 問の詳細で返す、問題 1 問ぶんの形。 */
const listedProblem = (p) => ({
  id: p.id, bookId: p.book_id, bookTitle: p.book_title, position: p.position, code: p.code,
  rows: p.rows, cols: p.cols, difficulty: p.difficulty, clueCount: p.clue_count, origin: p.origin, source: p.source,
  loopLength: p.loop_length, patternShare: p.pattern_share, freeShare: p.free_share,
  assumeCount: p.assume_count, longestSteps: p.longest_steps, coverage: p.coverage, largestGap: p.largest_gap,
  createdAt: p.created_at,
});

async function allProblems(db) {
  const { results } = await db.prepare(
    `SELECT p.*, b.title AS book_title FROM book_problems p JOIN books b ON b.id = p.book_id
     ORDER BY b.created_at, b.id, p.position`,
  ).all();
  return json({ problems: results.map(listedProblem) });
}

/** 1 問の詳細。問題集の中で前後の問題と、問題集の問題数も添える。 */
async function oneProblem(db, id) {
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'ありません');
  const p = await db.prepare(
    'SELECT p.*, b.title AS book_title FROM book_problems p JOIN books b ON b.id = p.book_id WHERE p.id = ?',
  ).bind(id).first();
  if (!p) throw new HttpError(404, 'その問題はありません');
  const [prev, next, count] = await db.batch([
    db.prepare('SELECT id FROM book_problems WHERE book_id = ? AND position < ? ORDER BY position DESC LIMIT 1').bind(p.book_id, p.position),
    db.prepare('SELECT id FROM book_problems WHERE book_id = ? AND position > ? ORDER BY position LIMIT 1').bind(p.book_id, p.position),
    db.prepare('SELECT COUNT(*) AS n FROM book_problems WHERE book_id = ?').bind(p.book_id),
  ]);
  return json({
    problem: listedProblem(p),
    bookCount: count.results[0].n,
    prevId: prev.results[0]?.id ?? null,
    nextId: next.results[0]?.id ?? null,
  });
}

/** 問題の出どころ。決まった値のほかは入れない。 */
const ORIGINS = ['scan', 'generated'];
const cleanOrigin = (v) => (ORIGINS.includes(v) ? v : null);

/** 難易度のほかの目安。おかしな値は入れない（無いものは NULL）。 */
function cleanStats(st) {
  const n = (v, hi) => (Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.round(v))) : null);
  if (!st || typeof st !== 'object') {
    return { loopLength: null, patternShare: null, freeShare: null, assumeCount: null, longestSteps: null, coverage: null, largestGap: null };
  }
  return {
    coverage: n(st.coverage, 100),
    // 盤の %、小数 1 桁
    largestGap: Number.isFinite(st.largestGap) ? Math.max(0, Math.min(1000, Math.round(st.largestGap * 10))) / 10 : null,
    loopLength: n(st.loopLength, 7200),
    patternShare: n(st.patternShare, 100),
    freeShare: n(st.freeShare, 100),
    assumeCount: n(st.assumeCount, 100000),
    longestSteps: n(st.longestSteps, 100000),
  };
}

/** 問題集の中の番号を 1, 2, 3… に詰め直す。 */
async function renumber(db, bookId) {
  const { results } = await db.prepare('SELECT id, position FROM book_problems WHERE book_id = ? ORDER BY position, id').bind(bookId).all();
  const fix = results
    .map((r, i) => ({ id: r.id, want: i + 1, has: r.position }))
    .filter((r) => r.want !== r.has)
    .map((r) => db.prepare('UPDATE book_problems SET position = ? WHERE id = ?').bind(r.want, r.id));
  if (fix.length) await db.batch(fix);
}
