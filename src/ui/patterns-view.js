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

const HINTS = [
  '数字のまわりの × を数え直す。1 つ増えるだけで確定する形は多いです。',
  '線の端（行き止まりになりかけの点）を探す。進める方向が 1 つなら確定です。',
  '「ここを線にしたらどうなるか」を 2〜3 手だけ追ってみる。矛盾したら反対側が確定です。',
  'ゲーム画面のヒントは、次に決まる場所とその理由を教えてくれます。',
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
 * @param {{scroller?: HTMLElement}} [options] 目次を押したときにスクロールさせる要素
 */
export function renderPatternsInto(container, options = {}) {
  container.textContent = '';

  container.append(intro(), legend(), toc(container, options.scroller));
  for (const category of CATEGORIES) {
    const items = PATTERNS.filter((p) => p.category === category.id);
    if (items.length) container.appendChild(section(category, items));
  }
  container.appendChild(outro());
  return container;
}

function intro() {
  const box = el('section', 'doc-lead');
  box.append(
    el('p', null, 'スリザーリンクは、同じ形が何度も出てきます。ここにある形を覚えてしまえば、一手ずつ考え込まなくても手が進むようになります。'),
  );
  const note = el('p', 'doc-note');
  note.append(
    document.createTextNode('このページの「確定する」はすべて、盤面を総当たりで調べて '),
    el('b', null, '反例が 1 つも存在しないこと'),
    document.createTextNode(' を確かめたものだけを載せています。'),
  );
  box.appendChild(note);
  return box;
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

function section(category, items) {
  const node = el('section', 'pat-section');
  node.id = category.id;
  node.append(el('h2', null, category.title), el('p', 'pat-lead', category.lead));
  const grid = el('div', 'pat-grid');
  for (const pattern of items) grid.appendChild(card(pattern));
  node.appendChild(grid);
  return node;
}

function card(pattern) {
  const article = el('article', 'pat-card');
  article.id = `pattern-${pattern.id}`;
  article.append(el('h3', null, pattern.title));

  const figure = el('div', 'pat-figure');
  figure.appendChild(renderPattern(pattern));
  article.append(figure, el('p', 'pat-why', pattern.why));

  if (pattern.caution) article.appendChild(el('p', 'pat-caution', pattern.caution));
  return article;
}

function outro() {
  const box = el('section', 'doc-lead doc-outro');
  box.appendChild(el('h2', null, '行き詰まったら'));
  const list = el('ul', 'rules');
  for (const hint of HINTS) list.appendChild(el('li', null, hint));
  box.append(list, el('p', 'doc-note', 'ここに無い形でも、突き詰めれば「数字の本数」「交点の線は 0 本か 2 本」「輪はひとつだけ」の 3 つに行き着きます。'));
  return box;
}
