/** localStorage まわり。使えない環境でも落ちないようにする。 */

import { samePuzzle } from '../core/puzzle.js';

const PREFIX = 'slitherlink:';

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
