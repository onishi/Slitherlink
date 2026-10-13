/**
 * 定石一覧の中身を組み立てる。
 * ゲーム画面のサイドバーからも、単独ページからも、同じものを使う。
 */

import { PATTERNS, CATEGORIES, combinesText } from '../core/patterns.js';
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

/** 出番の多さで 3 段に分ける（usage は 1 問あたりに決められる辺の本数）。 */
const TIERS = [
  { id: 'often', title: 'よく使う', min: 5, lead: 'ほぼ毎問、何度も出てきます。まずはここから。' },
  { id: 'sometimes', title: 'ときどき使う', min: 1, lead: '行き詰まったら探してみる形です。' },
  { id: 'rare', title: 'たまに使う', min: -Infinity, lead: '出番は少ないものの、見つかると一気に進みます。', folded: true },
];

/**
 * 定石一覧をまるごと container の中に作る。出番の多さで 3 段に分け、段の中も多い順に並べる。
 * @param {HTMLElement} container
 * @param {object} [options]
 * @param {(pattern:object)=>void} [options.onApply] 「当てはめる」を押したときの処理（盤面があるとき）
 * @param {boolean} [options.onlyUsable] 最初から「いま使える定石だけ表示」にしておくか
 * @param {(on:boolean)=>void} [options.onFilterChange] 表示の切り替えを覚えておくための通知
 * @returns {{setCounts:(counts:Map<string,number>)=>void}} 件数バッジの更新口
 */
export function renderPatternsInto(container, options = {}) {
  container.textContent = '';
  const inGame = Boolean(options.onApply);
  const actions = new Map();
  const cards = new Map();
  const sections = [];
  let counts = null;
  let onlyUsable = inGame ? options.onlyUsable === true : false;

  // 盤面があるときだけ「いま使える定石だけ表示」を出す
  let filter = null;
  let status = null;
  if (inGame) {
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

  // 図の読み方は一度読めば足りるので、ゲーム中は畳んでおく
  container.appendChild(legend(!inGame));

  for (const tier of TIERS) {
    const items = PATTERNS.filter((p) => p.usage >= tier.min && !TIERS.some((t) => t.min > tier.min && p.usage >= t.min));
    if (!items.length) continue;
    const node = document.createElement('details');
    node.className = 'pat-tier';
    node.id = `tier-${tier.id}`;
    node.open = !(inGame && tier.folded);
    const summary = document.createElement('summary');
    summary.append(el('span', 'pat-tier-title', tier.title), el('span', 'pat-tier-count', `${items.length} 個`));
    node.append(summary, el('p', 'pat-lead', tier.lead));
    const grid = el('div', 'pat-grid');
    for (const pattern of items) {
      const c = card(pattern, options, actions);
      cards.set(pattern.id, c);
      grid.appendChild(c);
    }
    node.appendChild(grid);
    container.appendChild(node);
    sections.push({ node, ids: items.map((p) => p.id), folded: !node.open });
  }

  const empty = el('p', 'pat-empty', 'いまの盤面で使える定石はありません。ヒントを使うか、別の場所を考えてみましょう。');
  empty.hidden = true;
  container.appendChild(empty);

  function refresh() {
    const filtering = onlyUsable && counts != null;
    let usable = 0;
    for (const [id, node] of cards) {
      const count = counts ? (counts.get(id) ?? 0) : 0;
      if (count > 0) usable++;
      node.hidden = filtering && count === 0;
    }
    for (const section of sections) {
      const visible = section.ids.some((id) => !cards.get(id).hidden);
      section.node.hidden = !visible;
      // 絞り込み中は、使える定石が畳まれた段に隠れないよう開いておく
      if (filtering && visible) section.node.open = true;
    }
    if (filter) {
      filter.setAttribute('aria-pressed', String(onlyUsable));
      filter.classList.toggle('is-on', onlyUsable);
      status.textContent = counts ? `いま使える定石 ${usable} 個` : '';
    }
    empty.hidden = !(filtering && usable === 0);
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

function legend(open) {
  const box = document.createElement('details');
  box.className = 'legend';
  box.open = open;
  const summary = document.createElement('summary');
  summary.textContent = '図の読み方';
  box.appendChild(summary);
  const list = el('ul', 'legend-list');
  for (const item of LEGEND) {
    const li = document.createElement('li');
    li.append(renderSwatch(item.kind), el('span', null, item.label));
    list.appendChild(li);
  }
  box.append(list, el('p', 'legend-note',
    '出番は、1 問を解くあいだにその定石で決められる辺の本数（実測の平均）です。段の中も出番の多い順に並んでいます。'));
  return box;
}

function card(pattern, options, actions) {
  const article = el('article', 'pat-card');
  article.id = `pattern-${pattern.id}`;

  const head = el('div', 'pat-head');
  head.appendChild(el('h3', null, pattern.title));
  if (options.onApply) head.appendChild(applyButton(pattern, options.onApply, actions));
  article.appendChild(head);

  const meta = el('p', 'pat-meta');
  const category = CATEGORIES.find((c) => c.id === pattern.category);
  meta.append(
    el('span', 'pat-tag', category ? category.title : ''),
    el('span', 'pat-usage', `出番 ${usageText(pattern.usage)}`),
  );
  article.appendChild(meta);

  const figure = el('div', 'pat-figure');
  figure.appendChild(renderPattern(pattern));
  article.append(figure, el('p', 'pat-why', pattern.why));
  const shortcut = combinesText(pattern);
  if (shortcut) article.appendChild(el('p', 'pat-combines', shortcut));

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
