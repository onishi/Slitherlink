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
 * 定石一覧をまるごと container の中に作る。出番の多い順に 1 列で並べる。
 * @param {HTMLElement} container
 * @param {object} [options]
 * @param {(pattern:object)=>void} [options.onApply] 「当てはめる」を押したときの処理
 * @param {boolean} [options.onlyUsable] 最初から「いま使える定石だけ表示」にしておくか
 * @param {(on:boolean)=>void} [options.onFilterChange] 表示の切り替えを覚えておくための通知
 * @returns {{setCounts:(counts:Map<string,number>)=>void}} 件数バッジの更新口
 */
export function renderPatternsInto(container, options = {}) {
  container.textContent = '';
  const actions = new Map();
  const cards = new Map();
  let counts = null;
  let onlyUsable = options.onApply ? options.onlyUsable === true : false;

  // 盤面があるときだけ「いま使える定石だけ表示」を出す
  let filter = null;
  let status = null;
  if (options.onApply) {
    const bar = el('div', 'pat-toolbar');
    filter = el('button', 'pat-filter', 'いま使える定石だけ表示');
    filter.type = 'button';
    filter.addEventListener('click', () => {
      onlyUsable = !onlyUsable;
      refresh();
      options.onFilterChange?.(onlyUsable);
    });
    status = el('span', 'pat-status');
    status.setAttribute('aria-live', 'polite');
    bar.append(filter, status);
    container.appendChild(bar);
  }

  container.appendChild(legend());

  container.appendChild(el('p', 'pat-lead',
    '解いているあいだに出番の多い順に並べています。数字は、1 問を解くあいだにその定石で決められる辺の本数（実測の平均）です。'));
  const grid = el('div', 'pat-grid');
  PATTERNS.forEach((pattern, i) => {
    const node = card(pattern, i + 1, options, actions);
    cards.set(pattern.id, node);
    grid.appendChild(node);
  });
  container.appendChild(grid);
  const empty = el('p', 'pat-empty', 'いまの盤面で使える定石はありません。ヒントを使うか、別の場所を考えてみましょう。');
  empty.hidden = true;
  container.appendChild(empty);

  function refresh() {
    let usable = 0;
    for (const [id, node] of cards) {
      const count = counts ? (counts.get(id) ?? 0) : 0;
      if (count > 0) usable++;
      node.hidden = onlyUsable && counts != null && count === 0;
    }
    if (filter) {
      filter.setAttribute('aria-pressed', String(onlyUsable));
      filter.classList.toggle('is-on', onlyUsable);
      status.textContent = counts ? `いま使える定石 ${usable} 個` : '';
    }
    empty.hidden = !(onlyUsable && counts != null && usable === 0);
  }
  refresh();

  return {
    /** 定石 id → 当てはまる場所の数。ボタンの表示と、絞り込みを更新する。 */
    setCounts(next) {
      counts = next;
      for (const [id, action] of actions) action.update(next.get(id) ?? 0);
      refresh();
    },
  };
}

/** 出番の多さを言葉にする。 */
function usageText(usage) {
  if (usage >= 1) return `1 問あたり約 ${Math.round(usage)} 本`;
  if (usage > 0) return '1 問あたり 1 本未満';
  return 'まれ';
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

function card(pattern, rank, options, actions) {
  const article = el('article', 'pat-card');
  article.id = `pattern-${pattern.id}`;

  const head = el('div', 'pat-head');
  head.appendChild(el('h3', null, pattern.title));
  if (options.onApply) head.appendChild(applyButton(pattern, options.onApply, actions));
  article.appendChild(head);

  const meta = el('p', 'pat-meta');
  const category = CATEGORIES.find((c) => c.id === pattern.category);
  meta.append(
    el('span', 'pat-rank', `${rank} 位`),
    el('span', 'pat-tag', category ? category.title : ''),
    el('span', 'pat-usage', `出番 ${usageText(pattern.usage)}`),
  );
  article.appendChild(meta);

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
