/** 定石一覧の単独ページ。中身は patterns-view.js と共通。 */

import { renderPatternsInto } from './patterns-view.js';

const PREFS_KEY = 'slitherlink:prefs';

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); }
  catch { return {}; }
}

const saved = readPrefs().theme;
if (saved) document.documentElement.dataset.theme = saved;

document.getElementById('btn-theme').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const current = root.dataset.theme || (dark ? 'dark' : 'light');
  root.dataset.theme = current === 'dark' ? 'light' : 'dark';
  const prefs = readPrefs();
  prefs.theme = root.dataset.theme;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* 無視 */ }
});

// 単独ページには盤面が無いので、当てはめボタンは出さない
renderPatternsInto(document.getElementById('patterns'));
