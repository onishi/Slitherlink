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

export const store = {
  prefs: () => read('prefs', {}),
  savePrefs: (p) => write('prefs', p),
  game: () => read('game', null),
  saveGame: (g) => write('game', g),
  clearGame: () => { try { localStorage.removeItem(PREFIX + 'game'); } catch { /* 無視 */ } },
  records: () => read('records', {}),
  /** 問題リスト（写真から作った問題や、とっておいた問題）。新しいものが先頭。 */
  library: () => read('library', []),
  saveToLibrary(entry) {
    // 以前の形式のコードで入っている同じ問題も 1 つにまとめる
    const list = read('library', []).filter((e) => e.code !== entry.code && !samePuzzle(e.code, entry.code));
    list.unshift({ ...entry, addedAt: Date.now() });
    write('library', list.slice(0, 200));
    return list.length;
  },
  removeFromLibrary(code) {
    write('library', read('library', []).filter((e) => e.code !== code));
  },
  saveRecord(key, seconds) {
    const all = read('records', {});
    if (all[key] == null || seconds < all[key]) {
      all[key] = seconds;
      write('records', all);
      return true;
    }
    return false;
  },
};
