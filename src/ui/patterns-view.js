/**
 * 定石一覧の中身を組み立てる。
 * ゲーム画面のサイドバーからも、単独ページからも、同じものを使う。
 */

import { PATTERNS, CATEGORIES } from '../core/patterns.js';
import { renderPattern, renderSwatch } from './pattern-render.js';

const LEGEND = [
  { kind: 'line', label: 'もとから分かっている線' },
  { kind: 'cross', label: 'もとから分かっている ×（線を引かない場所）' },
  { kind: 'new-line', label: 'ここが線で確定する' },
  { kind: 'new-cross', label: 'ここが × で確定する' },
];


const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/**
 * 定石一覧をまるごと container の中に作る。
 * @param {HTMLElement} container
 * @param {object} [options]
 * @param {HTMLElement} [options.scroller] 目次を押したときにスクロールさせる要素
 * @param {(pattern:object)=>void} [options.onApply] 「当てはめる」を押したときの処理
 * @returns {{setCounts:(counts:Map<string,number>)=>void}} 件数バッジの更新口
 */
export function renderPatternsInto(container, options = {}) {
  container.textContent = '';
  const actions = new Map();

  container.append(legend(), toc(container, options.scroller));
  for (const category of CATEGORIES) {
    const items = PATTERNS.filter((p) => p.category === category.id);
    if (items.length) container.appendChild(section(category, items, options, actions));
  }

  return {
    /** 定石 id → 当てはまる場所の数。ボタンの表示を更新する。 */
    setCounts(counts) {
      for (const [id, action] of actions) action.update(counts.get(id) ?? 0);
    },
  };
}

function legend() {
  const box = el('section', 'legend');
  box.setAttribute('aria-label', '図の読み方');
  box.appendChild(el('h2', null, '図の読み方'));
  const list = el('ul', 'legend-list');
  for (const item of LEGEND) {
    const li = document.createElement('li');
    li.append(renderSwatch(item.kind), el('span', null, item.label));
    list.appendChild(li);
  }
  box.appendChild(list);
  return box;
}

function toc(container, scroller) {
  const nav = el('nav', 'toc');
  nav.setAttribute('aria-label', '目次');
  const list = document.createElement('ul');
  for (const category of CATEGORIES) {
    if (!PATTERNS.some((p) => p.category === category.id)) continue;
    const li = document.createElement('li');
    const link = el('a', null, category.title);
    link.href = `#${category.id}`;
    link.addEventListener('click', (ev) => {
      const target = container.querySelector(`#${CSS.escape(category.id)}`);
      if (!target) return;
      ev.preventDefault();
      // ドロワーの中では、ページではなくドロワーをスクロールさせたい
      const box = scroller || document.scrollingElement;
      const offset = target.getBoundingClientRect().top - box.getBoundingClientRect().top;
      box.scrollBy({ top: scroller ? offset - 8 : offset - 12, behavior: 'smooth' });
    });
    li.appendChild(link);
    list.appendChild(li);
  }
  nav.appendChild(list);
  return nav;
}

function section(category, items, options, actions) {
  const node = el('section', 'pat-section');
  node.id = category.id;
  node.append(el('h2', null, category.title), el('p', 'pat-lead', category.lead));
  const grid = el('div', 'pat-grid');
  for (const pattern of items) grid.appendChild(card(pattern, options, actions));
  node.appendChild(grid);
  return node;
}

function card(pattern, options, actions) {
  const article = el('article', 'pat-card');
  article.id = `pattern-${pattern.id}`;

  const head = el('div', 'pat-head');
  head.appendChild(el('h3', null, pattern.title));
  if (options.onApply) head.appendChild(applyButton(pattern, options.onApply, actions));
  article.appendChild(head);

  const figure = el('div', 'pat-figure');
  figure.appendChild(renderPattern(pattern));
  article.append(figure, el('p', 'pat-why', pattern.why));

  if (pattern.caution) article.appendChild(el('p', 'pat-caution', pattern.caution));
  return article;
}

function applyButton(pattern, onApply, actions) {
  const button = el('button', 'pat-apply');
  button.type = 'button';
  const label = el('span', 'pat-apply-label', '当てはめる');
  const badge = el('span', 'pat-apply-count', '0');
  button.append(label, badge);
  button.addEventListener('click', () => onApply(pattern));

  actions.set(pattern.id, {
    update(count) {
      badge.textContent = String(count);
      button.disabled = count === 0;
      button.classList.toggle('is-ready', count > 0);
      button.setAttribute('aria-label',
        count > 0
          ? `${pattern.title}を当てはめる（${count} か所）`
          : `${pattern.title}は、いまの盤面に当てはまる場所がありません`);
    },
  });
  return button;
}
