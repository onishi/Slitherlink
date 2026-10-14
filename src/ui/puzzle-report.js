/**
 * メニューの「この問題の難易度」。いまの問題を空の盤から解き進めて、
 * 定石だけで解けるか・仮定が要るか・仮定を何段重ねるかを、ことばと帯グラフで出す。
 * 調べるのは裏のワーカー（重い問題でも画面を止めない）。結果は問題ごとに覚えておく。
 */
import { encodePuzzle } from '../core/puzzle.js';
import { difficultyReport, levelOf, LEVELS } from '../core/difficulty-report.js';
import { DIFFICULTIES } from '../core/generator.js';

const WORKER_URL = new URL('../worker/check-worker.js', import.meta.url);

/** 帯グラフの段（決まった辺を、どの考え方で決めたか）。 */
const STAGES = [
  { key: 'plain', label: 'ふつうの定石' },
  { key: 'rule', label: '基本ルールの組み合わせ' },
  { key: 'search', label: '読みの定石' },
  { key: 'assume1', label: '仮定 1 段' },
  { key: 'assume2', label: '仮定 2 段' },
];

const pct = (x) => `${Math.round(x * 100)}%`;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export class PuzzleReport {
  /**
   * @param {HTMLElement} container くわしい分析を出す場所
   * @param {HTMLElement} [summary] 「ふつう」のように、ひとことだけ出す場所（メニューの最初の画面）
   */
  constructor(container, summary) {
    this.container = container;
    this.summary = summary;
    this.cache = new Map();
    this.pending = null;
    this.id = 0;
    try {
      this.worker = new Worker(WORKER_URL, { type: 'module' });
      this.worker.onmessage = (ev) => this._onMessage(ev.data);
    } catch {
      this.worker = null;
    }
  }

  /** いまの問題の結果を出す（まだなら調べ始める）。 */
  show(puzzle) {
    if (!puzzle) return;
    const code = encodePuzzle(puzzle);
    this.current = code;
    const known = this.cache.get(code);
    if (known) { this._render(known); return; }
    this.container.textContent = '';
    this.container.append(el('p', 'report-wait', '解き進めて調べています…'));
    if (this.summary) this.summary.textContent = '調べています…';
    if (this.pending === code) return;
    this.pending = code;
    const msg = {
      type: 'report', id: ++this.id, code, rows: puzzle.rows, cols: puzzle.cols,
      clues: Array.from(puzzle.clues), solution: puzzle.solution ? Array.from(puzzle.solution) : null,
    };
    if (this.worker) this.worker.postMessage(msg);
    else setTimeout(() => this._onMessage({ id: msg.id, code, report: difficultyReport(puzzle) }), 0);
    this.pendingId = msg.id;
  }

  _onMessage(msg) {
    if (msg.type && msg.type !== 'report') return;
    if (msg.id !== this.pendingId) return;
    const code = this.pending;
    this.pending = null;
    if (msg.error) {
      if (this.current === code) {
        this.container.textContent = `調べられませんでした（${msg.error}）`;
        if (this.summary) this.summary.textContent = '';
      }
      return;
    }
    this.cache.set(code, msg.report);
    if (this.current === code) this._render(msg.report);
  }

  _render(r) {
    if (this.summary) this.summary.textContent = DIFFICULTIES[levelOf(r)].label;
    renderReport(this.container, r);
  }

  /** ほかで調べ済みの結果（写真から作った問題など）を覚えておく。 */
  remember(puzzle, report) {
    if (report) this.cache.set(encodePuzzle(puzzle), report);
  }
}

/**
 * 分析の結果を、ことば・帯グラフ・メモ・難易度の段の説明として box の中に描く。
 * メニューの「この問題の難易度」と、写真から作るときの確かめで使う。
 */
export function renderReport(box, r) {
  box.textContent = '';
  const key = levelOf(r);
  const level = DIFFICULTIES[key];
  const badge = el('p', 'report-level');
  badge.append('解き味は ', el('b', null, `「${level.label}」`));
  box.append(badge, el('p', 'report-verdict', verdict(r)));

  // 帯グラフ：決まった辺を、どの考え方で決めたか
  const bar = el('div', 'report-bar');
  bar.setAttribute('role', 'img');
  const legend = el('ul', 'report-legend');
  const parts = [];
  for (const stage of STAGES) {
    const n = r.decided[stage.key];
    if (!n) continue;
    const share = n / r.total;
    const seg = el('span', `report-seg seg-${stage.key}`);
    seg.style.flexGrow = String(n);
    bar.appendChild(seg);
    const li = el('li');
    li.append(el('span', `report-swatch seg-${stage.key}`), `${stage.label} ${pct(share)}`);
    legend.appendChild(li);
    parts.push(`${stage.label} ${pct(share)}`);
  }
  bar.setAttribute('aria-label', `決まった辺の内訳: ${parts.join('、')}`);
  box.append(bar, legend);

  const notes = el('ul', 'report-notes');
  const add = (text) => notes.appendChild(el('li', null, text));
  if (r.beforeAssume < 1) {
    add(`仮定なしで盤の ${pct(r.beforeAssume)} まで進めます。そこで初めて仮定が要ります。`);
  } else {
    add('定石と基本ルールを当てはめていくだけで、最後まで一度も仮定が要りません。');
  }
  const assumes = r.stalls.filter((s) => s.kind === 'assume');
  if (assumes.length) {
    const list = assumes.map((s) => `盤の ${pct(s.progress)} まで進んだところで${s.depth >= 2 ? '仮定 2 段' : '仮定 1 段'}（${s.steps} 手の読み）`);
    add(`仮定が要る場面: ${list.join('、')}。`);
  }
  if (r.decided.rule) {
    add(`定石にはない、基本ルールの組み合わせで決まる辺が ${r.decided.rule} 本あります。`);
  }
  if (r.decided.search) {
    const names = r.usedPatterns.filter((u) => u.search).map((u) => `「${u.title}」`);
    add(`局所的に場合分けする「読みの定石」を使います: ${names.join('・')}。`);
  }
  const top = r.usedPatterns.filter((u) => !u.search).slice(0, 3).map((u) => `「${u.title}」${u.edges} 本`);
  if (top.length) add(`よく使う定石: ${top.join('・')}。`);
  box.appendChild(notes);

  // 難易度の段ごとの意味（どの考え方まで要るか）。いまの問題の段を目立たせる
  box.appendChild(el('p', 'report-scale-head', '難易度の段と、それぞれで要る考え方'));
  const scale = el('ol', 'report-scale');
  for (const k of LEVELS) {
    const li = el('li', k === key ? 'is-current' : null);
    li.append(el('b', null, DIFFICULTIES[k].label), el('span', null, DIFFICULTIES[k].about));
    if (k === key) li.setAttribute('aria-current', 'true');
    scale.appendChild(li);
  }
  box.appendChild(scale);
}

/** ひとことで言うと。 */
function verdict(r) {
  if (r.deepCount) {
    return `仮定の中でさらに仮定する 2 段の読みが ${r.deepCount} 回要ります（仮定は全部で ${r.assumeCount} 回）。`;
  }
  if (r.assumeCount === 1) return '仮定が 1 回要ります。1 か所を仮定して矛盾を見る、1 段の読みで済みます。';
  if (r.assumeCount) return `仮定が ${r.assumeCount} 回要ります。どれも 1 か所を仮定して矛盾を見る、1 段の読みで済みます。`;
  if (!r.decided.search && !r.decided.rule) return 'ふつうの定石だけで解けます。仮定は要りません。';
  if (!r.decided.search) return '定石と基本ルールだけで解けます。仮定は要りません。';
  return '定石だけで解けます（読みの定石も使います）。仮定は要りません。';
}
