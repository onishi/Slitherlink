/**
 * 管理画面：問題集をまたいだ問題一覧。全部の問題集の問題を 1 つの表に並べ、
 * 問題集・出どころ・大きさ・むずかしさで絞り込み、列の見出しで並べ替える。行を押すと問題の詳細へ。
 * 絞り込みと並べ替えは URL に残す（詳細から戻ったとき、同じ表に戻れるように）。
 */

import { $, el, icon, api, startAdmin, metricGuide, METRIC_HELP, ORIGIN_LABEL, LEVEL_ORDER } from './admin-common.js';
import { DIFFICULTIES } from '../core/generator.js';
import { decodePuzzle } from '../core/puzzle.js';
import { nikoliCheck } from '../core/nikoli.js';

const FILTERS = [['f-book', 'book'], ['f-origin', 'origin'], ['f-size', 'size'], ['f-level', 'level'], ['f-nikoli', 'nikoli']];

let allRows = [];
let sortKey = 'bookTitle';
let sortDir = 1;

const pctOrDash = (v) => (v == null ? '—' : `${v}%`);

const COLS = [
  ['bookTitle', '問題集', (r) => r.bookTitle, 'text'],
  ['position', '番号', (r) => `${r.position}`],
  ['cells', '大きさ', (r) => r.size],
  ['level', 'むずかしさ', (r) => DIFFICULTIES[r.difficulty]?.label ?? '—', 'text'],
  ['origin', '出どころ', (r) => ORIGIN_LABEL[r.origin ?? 'unknown'], 'text'],
  ['nikoli', 'ニコリ風', (r) => (r.nikoli.ok === true ? '○' : r.nikoli.ok === false ? `× ${r.nikoli.failed.join('・')}` : '？'), 'text'],
  ['clueDensity', '数字の割合', (r) => `${r.clueDensity.toFixed(0)}%`],
  ['loopPerCell', '線／マス', (r) => (r.loopPerCell == null ? '—' : (r.loopPerCell / 100).toFixed(2))],
  ['coverage', '行き渡り', (r) => pctOrDash(r.coverage)],
  ['largestGap', '最大の空き地', (r) => pctOrDash(r.largestGap)],
  ['patternShare', '定石', (r) => pctOrDash(r.patternShare)],
  ['freeShare', '仮定なし', (r) => pctOrDash(r.freeShare)],
  ['assumeCount', '仮定', (r) => (r.assumeCount == null ? '—' : `${r.assumeCount}`)],
  ['longestSteps', '最長の読み', (r) => (r.longestSteps == null ? '—' : `${r.longestSteps} 手`)],
];

/** 平均の行の書き方（列ごと）。 */
const AVG_FMT = {
  clueDensity: (v) => `${v.toFixed(0)}%`,
  coverage: (v) => `${v.toFixed(0)}%`,
  largestGap: (v) => `${v.toFixed(1)}%`,
  patternShare: (v) => `${v.toFixed(0)}%`,
  freeShare: (v) => `${v.toFixed(0)}%`,
  loopPerCell: (v) => (v / 100).toFixed(2),
  assumeCount: (v) => v.toFixed(1),
  longestSteps: (v) => `${v.toFixed(1)} 手`,
};

const sortValue = (r, key) => {
  if (key === 'cells') return r.rows * r.cols * 1000 + r.rows;
  if (key === 'level') return LEVEL_ORDER.indexOf(r.difficulty);
  if (key === 'nikoli') return r.nikoli.ok === true ? 0 : r.nikoli.ok === false ? 1 + r.nikoli.failed.length : 0.5;
  if (key === 'bookTitle') return `${r.bookTitle}\u0000${String(r.position).padStart(5, '0')}`;
  return r[key];
};

async function load() {
  $('f-count').textContent = '読み込んでいます…';
  const { problems } = await api('/api/admin/problems');
  allRows = problems.map((p) => ({
    ...p,
    size: `${p.rows}×${p.cols}`,
    clueDensity: (100 * p.clueCount) / (p.rows * p.cols),
    loopPerCell: p.loopLength == null ? null : (100 * p.loopLength) / (p.rows * p.cols),
    nikoli: nikoliOf(p),
  }));
  fillFilters();
  readUrl();
  render();
}

/** ニコリ風の条件に当てはまるか（点対称を見るのに、問題コードから数字の配置を読む）。 */
function nikoliOf(p) {
  let clues;
  try { clues = decodePuzzle(p.code).clues; } catch { clues = undefined; }
  return nikoliCheck({ ...p, clues });
}

function fillFilters() {
  const set = (id, items) => {
    const sel = $(id);
    sel.length = 1;
    for (const [value, label] of items) sel.add(new Option(label, value));
  };
  set('f-book', [...new Map(allRows.map((r) => [String(r.bookId), r.bookTitle]))]);
  const sizes = [...new Map(allRows.map((r) => [r.size, r.rows * r.cols])).entries()].sort((a, b) => a[1] - b[1]);
  set('f-size', sizes.map(([s]) => [s, s]));
  set('f-level', LEVEL_ORDER.map((k) => [k, DIFFICULTIES[k].label]));
}

function readUrl() {
  const q = new URLSearchParams(location.search);
  for (const [id, key] of FILTERS) {
    const v = q.get(key) ?? '';
    const sel = $(id);
    sel.value = [...sel.options].some((o) => o.value === v) ? v : '';
  }
  const sort = q.get('sort');
  if (sort && COLS.some(([k]) => k === sort)) sortKey = sort;
  sortDir = q.get('dir') === 'desc' ? -1 : 1;
}

function writeUrl() {
  const q = new URLSearchParams();
  for (const [id, key] of FILTERS) if ($(id).value) q.set(key, $(id).value);
  if (sortKey !== 'bookTitle') q.set('sort', sortKey);
  if (sortDir < 0) q.set('dir', 'desc');
  const s = q.toString();
  history.replaceState(null, '', s ? `?${s}` : location.pathname);
  try { sessionStorage.setItem('admin-problems-query', s ? `?${s}` : ''); } catch { /* 覚えられなくても困らない */ }
}

function filteredRows() {
  const [book, origin, size, level, nikoli] = FILTERS.map(([id]) => $(id).value);
  return allRows.filter((r) => (!book || String(r.bookId) === book)
    && (!origin || r.origin === origin) && (!size || r.size === size) && (!level || r.difficulty === level)
    && (!nikoli || (nikoli === 'yes' ? r.nikoli.ok === true : r.nikoli.ok === false)));
}

/** 列の見出しに添える説明（見出しの名前と目安の名前が違うものはそろえる）。 */
const helpOf = (label) => {
  const name = { '線／マス': '線の本数／マス' }[label] ?? label;
  return METRIC_HELP.find(([n]) => n === name)?.[1];
};

const detailUrl = (r) => `problem.html?id=${r.id}`;

function render() {
  writeUrl();
  const rows = filteredRows().sort((a, b) => {
    const x = sortValue(a, sortKey);
    const y = sortValue(b, sortKey);
    if (x == null && y == null) return 0;
    if (x == null) return 1; // 値の無いものは下へ
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sortDir;
  });
  const table = $('problem-table');
  table.textContent = '';
  const head = el('tr');
  for (const [key, label] of COLS) {
    const th = el('th');
    const b = el('button', `admin-sort${sortKey === key ? ' is-on' : ''}`, label + (sortKey === key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''));
    b.type = 'button';
    b.title = helpOf(label) ?? '';
    b.addEventListener('click', () => {
      if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = 1; }
      render();
    });
    th.append(b);
    head.append(th);
  }
  head.append(el('th'));
  table.append(head);
  for (const r of rows) {
    const tr = el('tr', `admin-row-link is-${r.origin ?? 'unknown'}`);
    for (const [key, , fmt, kind] of COLS) {
      const td = el('td', kind === 'text' ? 'is-text' : null);
      if (key === 'position') {
        // 番号は詳細へのリンク（キーボードでもたどれるように）
        const a = el('a', 'admin-link', fmt(r));
        a.href = detailUrl(r);
        td.append(a);
      } else {
        td.textContent = fmt(r);
      }
      tr.append(td);
    }
    const td = el('td');
    const play = el('a', 'admin-link');
    play.href = `../?p=${encodeURIComponent(r.code)}`;
    play.target = '_blank';
    play.rel = 'noopener';
    play.append(icon('play_arrow'), '遊ぶ');
    td.append(play);
    tr.append(td);
    // 行のどこを押しても詳細へ（リンクを押したときはそちらに任せる）
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return;
      location.href = detailUrl(r);
    });
    table.append(tr);
  }
  // 絞り込んだ問題の平均（くらべたいものだけ残して見る）
  if (rows.length) {
    const avg = (key) => {
      const v = rows.map((r) => r[key]).filter((x) => x != null);
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
    };
    const tr = el('tr', 'admin-avg-row');
    for (const [key] of COLS) {
      let text = '';
      if (key === 'bookTitle') text = `平均（${rows.length} 問）`;
      else if (key === 'nikoli') text = `○ ${rows.filter((r) => r.nikoli.ok === true).length} 問`;
      else if (AVG_FMT[key]) text = avg(key) == null ? '—' : AVG_FMT[key](avg(key));
      tr.append(el('td', key === 'bookTitle' ? 'is-text' : null, text));
    }
    tr.append(el('td'));
    table.append(tr);
  }
  $('f-count').textContent = `${rows.length} 問 / 全 ${allRows.length} 問`;
}

for (const [id] of FILTERS) $(id).addEventListener('change', render);
$('f-count').before(metricGuide());
startAdmin(() => load().catch((err) => { $('f-count').textContent = err.message || '読み込めませんでした'; }));
