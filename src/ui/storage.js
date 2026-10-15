/** localStorage まわり。使えない環境でも落ちないようにする。 */

import { samePuzzle } from '../core/puzzle.js';

const PREFIX = 'gridloop:';
const KEYS = ['prefs', 'game', 'records', 'library'];

/**
 * 以前の名前で保存した設定・途中の盤面・記録・問題リストを、いまの名前の場所へ移す（1 回だけ）。
 * 古い名前は書かず、「<英小文字>:<上のキー>」の形をしたものを探して移す。
 * 同じ場所（同じアドレス）で保存したものだけが対象になる。
 */
function migrate() {
  try {
    if (KEYS.some((k) => localStorage.getItem(PREFIX + k) !== null)) return;
    // 書き足すと並び順が変わるので、先に名前を全部集めてから移す
    const names = [];
    for (let i = 0; i < localStorage.length; i++) names.push(localStorage.key(i));
    for (const key of names) {
      const m = /^([a-z]+):([a-z]+)$/.exec(key ?? '');
      if (!m || `${m[1]}:` === PREFIX || !KEYS.includes(m[2])) continue;
      localStorage.setItem(PREFIX + m[2], localStorage.getItem(key));
      localStorage.removeItem(key);
    }
  } catch { /* 使えない環境では何もしない */ }
}
migrate();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* 無視 */ }
}

// ログインしているときの写し（サーバーの内容）は「acct:」の下に持ち、ゲストのデータとは混ぜない
const ACCT = 'acct:';
let remote = null;      // サーバーへ送る口（ログイン中だけ）
let gameTimer = 0;      // 途中の盤面は、続けて動かしているあいだはまとめて送る
let pendingGame = null;
const GAME_DELAY = 1500;

const acct = () => !!read(ACCT + 'user', null);
const key = (k) => (acct() ? ACCT + k : k);
/** サーバーへの書き込みは失敗しても画面を止めない（写しには入っているので、次の同期で揃う）。 */
const send = (fn) => { if (remote) fn(remote)?.catch?.(() => {}); };

function sendGameNow(keepalive = false) {
  clearTimeout(gameTimer);
  gameTimer = 0;
  const g = pendingGame;
  pendingGame = null;
  if (g && remote) remote.saveGame(g, keepalive).catch(() => {});
}

// 閉じる・裏へ回るときは、まとめ待ちの盤面をすぐ送る
try {
  addEventListener('pagehide', () => sendGameNow(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sendGameNow(true); });
} catch { /* 画面の無い環境 */ }

export const store = {
  prefs: () => read('prefs', {}),
  savePrefs: (p) => write('prefs', p),

  /* ---------- ログイン ---------- */
  /** 前回ログインしていた人（サーバーに聞く前に、すぐ写しを使うため）。 */
  cachedUser: () => read(ACCT + 'user', null),
  setUser(user) {
    if (user) write(ACCT + 'user', user);
    else try { localStorage.removeItem(PREFIX + ACCT + 'user'); } catch { /* 無視 */ }
  },
  useRemote(r) { remote = r; },
  /** サーバーから読んだ内容を写しへ入れる。途中の盤面は新しいほうを残す。 */
  applyServer(data) {
    write(ACCT + 'library', data.library ?? []);
    write(ACCT + 'history', data.history ?? []);
    write(ACCT + 'records', data.records ?? {});
    const local = read(ACCT + 'game', null);
    const server = data.game;
    if (server && (!local || (server.updatedAt ?? 0) > (local.updatedAt ?? 0))) write(ACCT + 'game', server);
    else if (local && (!server || (local.updatedAt ?? 0) > (server.updatedAt ?? 0))) {
      // この端末のほうが新しい（送る前に閉じたなど）ので送り直す
      send((r) => r.saveGame(local));
    }
  },
  /** 初めてのログインで取り込む、ゲストのデータ。 */
  guestData: () => ({ library: read('library', []), records: read('records', {}), game: read('game', null) }),
  clearAccountCopy() {
    for (const k of ['library', 'history', 'records', 'game', 'user']) {
      try { localStorage.removeItem(PREFIX + ACCT + k); } catch { /* 無視 */ }
    }
  },

  /* ---------- 途中の盤面 ---------- */
  game: () => read(key('game'), null),
  saveGame(g) {
    const entry = { ...g, updatedAt: Date.now() };
    write(key('game'), entry);
    if (!remote) return;
    pendingGame = entry;
    clearTimeout(gameTimer);
    gameTimer = setTimeout(() => sendGameNow(), GAME_DELAY);
  },
  flushGame: () => sendGameNow(),
  clearGame() {
    try { localStorage.removeItem(PREFIX + key('game')); } catch { /* 無視 */ }
    clearTimeout(gameTimer);
    pendingGame = null;
    send((r) => r.deleteGame());
  },

  /* ---------- 自己ベスト ---------- */
  records: () => read(key('records'), {}),
  saveRecord(k, seconds) {
    const all = read(key('records'), {});
    if (all[k] == null || seconds < all[k]) {
      all[k] = seconds;
      write(key('records'), all);
      return true;
    }
    return false;
  },

  /* ---------- 問題リスト（ログイン中だけ） ---------- */
  /** 新しいものが先頭。ゲストのあいだは使えない（空）。 */
  library: () => (acct() ? read(ACCT + 'library', []) : []),
  saveToLibrary(entry) {
    if (!acct()) return 0;
    const item = { ...entry, addedAt: Date.now() };
    // 以前の形式のコードで入っている同じ問題も 1 つにまとめる
    const list = read(ACCT + 'library', []).filter((e) => e.code !== entry.code && !samePuzzle(e.code, entry.code));
    list.unshift(item);
    write(ACCT + 'library', list.slice(0, 200));
    send((r) => r.addLibrary(item));
    return list.length;
  },
  removeFromLibrary(code) {
    if (!acct()) return;
    write(ACCT + 'library', read(ACCT + 'library', []).filter((e) => e.code !== code));
    send((r) => r.removeLibrary(code));
  },

  /* ---------- 解いた履歴（ログイン中だけ） ---------- */
  history: () => (acct() ? read(ACCT + 'history', []) : []),
  addHistory(entry) {
    if (!acct()) return;
    const item = { ...entry, solvedAt: Date.now() };
    write(ACCT + 'history', [item, ...read(ACCT + 'history', [])].slice(0, 200));
    send((r) => r.addHistory(entry));
  },
};
