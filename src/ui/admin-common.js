/**
 * 管理画面のページ（問題集・問題一覧・問題の詳細）で共通に使うもの。
 * ログインと管理者の確かめ、画面部品の小道具、問題を確かめる裏のワーカー、盤の絵。
 */

import { account, api } from './account.js';

export { account, api };

export const $ = (id) => document.getElementById(id);

export const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export const icon = (name) => {
  const s = el('span', 'mi', name);
  s.setAttribute('aria-hidden', 'true');
  return s;
};

export const ORIGIN_LABEL = { scan: 'スキャン', generated: '自動作問', unknown: '出どころ不明' };
export const LEVEL_ORDER = ['intro', 'easy', 'normal', 'hard', 'expert'];

/**
 * ログインと管理者の確かめ。管理者なら #admin-main を出して onReady を呼ぶ（何度ログインし直しても 1 回だけ）。
 * そうでなければ #admin-gate にログインのボタンか、管理者でないことを出す。
 */
export async function startAdmin(onReady) {
  let started = false;
  const gate = () => {
    const ok = account.loggedIn && account.isAdmin;
    $('admin-main').hidden = !ok;
    $('admin-gate').hidden = ok;
    renderAccount();
    if (ok) {
      if (!started) { started = true; onReady(); }
      return;
    }
    const text = $('gate-text');
    const login = $('gate-login');
    login.textContent = '';
    if (!account.ready) { text.textContent = '確かめています…'; return; }
    if (!account.loggedIn) {
      text.textContent = '管理画面を使うには、管理者の Google アカウントでログインしてください。';
      account.renderButton(login);
    } else {
      text.textContent = 'このアカウントは管理者ではありません。';
    }
  };
  account.onChange = gate;
  await account.init();
  gate();
}

function renderAccount() {
  const box = $('admin-account');
  box.textContent = '';
  if (!account.loggedIn) return;
  box.append(el('span', null, account.user.name || account.user.email || ''));
  const out = el('button', 'account-logout', 'ログアウト');
  out.type = 'button';
  out.addEventListener('click', () => account.logout());
  box.append(out);
}

/** 問題が論理だけで解けるかと、くわしい解き味を、画面を止めずに調べる（裏のワーカー）。 */
export const checker = (() => {
  let worker = null;
  let seq = 0;
  const waiting = new Map();
  return (rows, cols, clues) => new Promise((resolve) => {
    worker ??= new Worker(new URL('../worker/check-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => { waiting.get(ev.data.id)?.(ev.data); waiting.delete(ev.data.id); };
    const id = ++seq;
    waiting.set(id, resolve);
    worker.postMessage({ id, rows, cols, clues: Array.from(clues) });
  });
})();

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/**
 * 盤の絵（SVG）。点と数字、solution を渡せば答えの線も描く。
 * @param {{rows:number, cols:number, clues:ArrayLike<number>}} puzzle
 * @param {ArrayLike<number>|null} [solution] 辺ごとに 1 なら線
 */
export function boardSvg({ rows, cols, clues }, solution = null) {
  const s = 10; // 1 マスの大きさ（viewBox の単位）
  const pad = 3;
  const svg = svgEl('svg', {
    viewBox: `${-pad} ${-pad} ${cols * s + pad * 2} ${rows * s + pad * 2}`,
    class: 'admin-board',
    role: 'img',
    'aria-label': `${rows}×${cols} の盤${solution ? '（答えつき）' : ''}`,
  });
  if (solution) {
    const hCount = (rows + 1) * cols;
    let d = '';
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) if (solution[r * cols + c] === 1) d += `M${c * s} ${r * s}h${s}`;
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) if (solution[hCount + r * (cols + 1) + c] === 1) d += `M${c * s} ${r * s}v${s}`;
    }
    svg.append(svgEl('path', { d, class: 'admin-board-line' }));
  }
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) svg.append(svgEl('circle', { cx: c * s, cy: r * s, r: 0.9, class: 'admin-board-dot' }));
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = clues[r * cols + c];
      if (v < 0) continue;
      const t = svgEl('text', { x: c * s + s / 2, y: r * s + s / 2, class: 'admin-board-clue' });
      t.textContent = String(v);
      svg.append(t);
    }
  }
  return svg;
}
