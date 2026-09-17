/** localStorage まわり。使えない環境でも落ちないようにする。 */

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
