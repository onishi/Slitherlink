/**
 * 盤面の描画と入力。SVG を 1 度だけ組み立て、以降は変化した辺だけ更新する。
 */

import { getGrid, UNKNOWN, LINE, CROSS } from '../core/grid.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD = 0.62;          // 盤面まわりの余白 (マス単位)
const PICK_RADIUS = 0.46;  // これより遠いクリックは無視する

export class Board {
  /**
   * @param {SVGSVGElement} svg
   * @param {{onPaint:(edge:number, value:number)=>void, onStrokeEnd:()=>void, onCursorMove?:Function}} handlers
   */
  constructor(svg, handlers) {
    this.svg = svg;
    this.handlers = handlers;
    this.grid = null;
    this.puzzle = null;
    this.state = null;
    this.rendered = null;
    this.edgeEls = [];
    this.crossEls = [];
    this.clueEls = [];
    this.dotEls = [];
    this.hintEdges = new Set();
    // ヒントの根拠（なぜそこが決まるのか）を示す場所
    this.focusCells = new Set();
    this.focusVertices = new Set();
    this.focusEdges = new Set();
    // 点線のカーソルは、キーボードで操作しているときだけ出す
    this.showCursor = false;
    this.showErrors = true;
    this.fadeDone = true;
    this.inputMode = 'line'; // 'line' か 'cross'。タップで最初に付く印が変わる
    this.cursor = -1;
    this._stroke = null;
    this._bindInput();
  }

  /** 問題を読み込んで SVG を組み立て直す。 */
  setPuzzle(puzzle, state) {
    this.puzzle = puzzle;
    this.grid = getGrid(puzzle.rows, puzzle.cols);
    this.state = state;
    this.rendered = new Int8Array(this.grid.edgeCount).fill(-1);
    this.hintEdges.clear();
    this.focusCells.clear();
    this.focusVertices.clear();
    this.focusEdges.clear();
    this.cursor = -1;
    this.showCursor = false;
    this._build();
    this.refresh();
  }

  _build() {
    const { rows, cols } = this.puzzle;
    const g = this.grid;
    const svg = this.svg;
    svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${cols + PAD * 2} ${rows + PAD * 2}`);
    svg.style.maxWidth = `${(cols + PAD * 2) * 48}px`;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const layer = (cls) => {
      const el = document.createElementNS(SVG_NS, 'g');
      el.setAttribute('class', cls);
      svg.appendChild(el);
      return el;
    };
    const focusLayer = layer('focus');
    const clueLayer = layer('clues');
    const crossLayer = layer('crosses');
    const dotLayer = layer('dots');
    const edgeLayer = layer('edges');
    const cursorLayer = layer('cursors');

    // ヒントの根拠となるマスの下地
    this.focusCellEls = new Array(g.cellCount);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('class', 'focus-cell');
        rect.setAttribute('x', c + 0.08);
        rect.setAttribute('y', r + 0.08);
        rect.setAttribute('width', 0.84);
        rect.setAttribute('height', 0.84);
        rect.setAttribute('rx', 0.14);
        focusLayer.appendChild(rect);
        this.focusCellEls[r * cols + c] = rect;
      }
    }

    // 数字
    this.clueEls = new Array(g.cellCount).fill(null);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = r * cols + c;
        if (this.puzzle.clues[cell] < 0) continue;
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('class', 'clue');
        t.setAttribute('x', c + 0.5);
        t.setAttribute('y', r + 0.5);
        t.setAttribute('dominant-baseline', 'central');
        t.textContent = String(this.puzzle.clues[cell]);
        clueLayer.appendChild(t);
        this.clueEls[cell] = t;
      }
    }

    // 点
    this.dotEls = new Array(g.vertexCount);
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const d = document.createElementNS(SVG_NS, 'circle');
        d.setAttribute('class', 'dot');
        d.setAttribute('cx', c);
        d.setAttribute('cy', r);
        d.setAttribute('r', 0.058);
        dotLayer.appendChild(d);
        this.dotEls[g.vtx(r, c)] = d;
      }
    }

    // 辺 (線) と × 印
    this.edgeEls = new Array(g.edgeCount);
    this.crossEls = new Array(g.edgeCount);
    for (let e = 0; e < g.edgeCount; e++) {
      const info = g.edgeInfo[e];
      const [x1, y1, x2, y2] = endpointsOf(info);
      const ln = document.createElementNS(SVG_NS, 'line');
      ln.setAttribute('class', 'edge');
      ln.setAttribute('x1', x1); ln.setAttribute('y1', y1);
      ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
      edgeLayer.appendChild(ln);
      this.edgeEls[e] = ln;

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const cr = document.createElementNS(SVG_NS, 'path');
      cr.setAttribute('class', 'cross');
      const s = 0.1;
      cr.setAttribute('d', `M${mx - s} ${my - s}L${mx + s} ${my + s}M${mx + s} ${my - s}L${mx - s} ${my + s}`);
      crossLayer.appendChild(cr);
      this.crossEls[e] = cr;
    }

    // キーボード操作用のカーソル
    this.cursorEl = document.createElementNS(SVG_NS, 'rect');
    this.cursorEl.setAttribute('class', 'cursor');
    this.cursorEl.setAttribute('rx', 0.06);
    cursorLayer.appendChild(this.cursorEl);
  }

  /** 表示を現在の状態に合わせる。変化した要素だけ触る。 */
  refresh() {
    if (!this.grid) return;
    const g = this.grid;
    const st = this.state;

    // 辺
    for (let e = 0; e < g.edgeCount; e++) {
      const want = st[e];
      const isHint = this.hintEdges.has(e);
      const key = want + (isHint ? 8 : 0) + (this.focusEdges.has(e) ? 16 : 0);
      if (this.rendered[e] === key) continue;
      this.rendered[e] = key;
      const ln = this.edgeEls[e];
      const isEvidence = this.focusEdges.has(e);
      ln.classList.toggle('line', want === LINE);
      ln.classList.toggle('hint', isHint && want !== CROSS);
      ln.classList.toggle('evidence', isEvidence && want === LINE);
      this.crossEls[e].classList.toggle('on', want === CROSS);
      this.crossEls[e].classList.toggle('hint', isHint && want === CROSS);
      this.crossEls[e].classList.toggle('evidence', isEvidence && want === CROSS);
    }

    // 数字の状態 (達成 / 矛盾)
    for (let cell = 0; cell < g.cellCount; cell++) {
      const el = this.clueEls[cell];
      if (!el) continue;
      const clue = this.puzzle.clues[cell];
      let lines = 0, unknown = 0;
      for (let k = 0; k < 4; k++) {
        const v = st[g.cellEdges[cell * 4 + k]];
        if (v === LINE) lines++;
        else if (v === UNKNOWN) unknown++;
      }
      const bad = this.showErrors && (lines > clue || lines + unknown < clue);
      el.classList.toggle('bad', bad);
      el.classList.toggle('done', !bad && this.fadeDone && lines === clue && unknown === 0);
    }

    // ヒントの根拠
    for (let cell = 0; cell < g.cellCount; cell++) {
      this.focusCellEls[cell].classList.toggle('on', this.focusCells.has(cell));
    }

    // 交点 (線が 3 本以上なら矛盾)
    for (let v = 0; v < g.vertexCount; v++) {
      let lines = 0;
      for (const e of g.vertexEdges[v]) if (st[e] === LINE) lines++;
      const el = this.dotEls[v];
      el.classList.toggle('lit', lines > 0);
      el.classList.toggle('focus', this.focusVertices.has(v));
      if (this.showErrors && lines > 2) el.setAttribute('fill', 'var(--danger)');
      else el.removeAttribute('fill');
    }

    this._drawCursor();
  }

  setHints(edges, focus) {
    this.hintEdges = new Set(edges);
    this.focusCells = new Set(focus?.cells ?? []);
    this.focusVertices = new Set(focus?.vertices ?? []);
    this.focusEdges = new Set(focus?.edges ?? []);
    this.rendered.fill(-1);
    this.refresh();
  }

  clearHints() {
    if (this.hintEdges.size === 0 && this.focusCells.size === 0 && this.focusVertices.size === 0) return;
    this.hintEdges.clear();
    this.focusCells.clear();
    this.focusVertices.clear();
    this.focusEdges.clear();
    this.showCursor = false;
    this.rendered.fill(-1);
    this.refresh();
  }

  setSolved(on) {
    this.svg.classList.toggle('solved', on);
  }

  /* ---------------- 入力 ---------------- */

  _bindInput() {
    const svg = this.svg;
    svg.addEventListener('contextmenu', (ev) => ev.preventDefault());

    svg.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 && ev.button !== 2) return;
      const e = this._pick(ev);
      if (e < 0) return;
      ev.preventDefault();
      // preventDefault でフォーカスが移らないので明示的に当てる。
      // 盤面をクリックしたあと、そのまま矢印キーで操作できるようにするため。
      svg.focus({ preventScroll: true });
      svg.setPointerCapture(ev.pointerId);
      const current = this.state[e];
      // 右クリック (Ctrl+クリック) は、いまのモードで主役でない方の印を付け外しする
      const secondary = this.inputMode === 'cross' ? LINE : CROSS;
      const value = (ev.button === 2 || ev.ctrlKey)
        ? (current === secondary ? UNKNOWN : secondary)
        : nextValue(current, this.inputMode);
      this._stroke = { value, touched: new Set([e]), pointerId: ev.pointerId };
      // 指やマウスで触ったときは点線を出さない（キーボード再開位置だけ覚える）
      this.cursor = e;
      this.showCursor = false;
      this._drawCursor();
      this.handlers.onPaint(e, value);
    });

    svg.addEventListener('pointermove', (ev) => {
      if (!this._stroke || ev.pointerId !== this._stroke.pointerId) return;
      const e = this._pick(ev);
      if (e < 0 || this._stroke.touched.has(e)) return;
      this._stroke.touched.add(e);
      this.cursor = e;
      // なぞった先は「消す」操作以外では上書きしない (誤操作防止)
      if (this._stroke.value !== UNKNOWN && this.state[e] !== UNKNOWN) return;
      this.handlers.onPaint(e, this._stroke.value);
    });

    const end = (ev) => {
      if (!this._stroke || ev.pointerId !== this._stroke.pointerId) return;
      this._stroke = null;
      if (svg.hasPointerCapture?.(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
      this.handlers.onStrokeEnd();
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    svg.addEventListener('keydown', (ev) => this._onKey(ev));
    svg.addEventListener('blur', () => {
      this.showCursor = false;
      this._drawCursor();
    });
  }

  _onKey(ev) {
    if (!this.grid) return;
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (dirs[ev.key]) {
      ev.preventDefault();
      this.cursor = this._moveCursor(dirs[ev.key]);
      this.showCursor = true;
      this._drawCursor();
      return;
    }
    if (this.cursor < 0) return;
    if (ev.key === ' ' || ev.key === 'Enter') {
      ev.preventDefault();
      this.showCursor = true;
      const cur = this.state[this.cursor];
      this.handlers.onPaint(this.cursor, cur === LINE ? UNKNOWN : LINE);
      this.handlers.onStrokeEnd();
    } else if (ev.key === 'x' || ev.key === 'X') {
      ev.preventDefault();
      this.showCursor = true;
      const cur = this.state[this.cursor];
      this.handlers.onPaint(this.cursor, cur === CROSS ? UNKNOWN : CROSS);
      this.handlers.onStrokeEnd();
    }
  }

  /** カーソルを方向 [dx, dy] に動かす。最も近い辺を選ぶ。 */
  _moveCursor([dx, dy]) {
    const g = this.grid;
    if (this.cursor < 0) return g.h(0, 0);
    const from = centerOf(g.edgeInfo[this.cursor]);
    let best = this.cursor;
    let bestScore = Infinity;
    for (let e = 0; e < g.edgeCount; e++) {
      if (e === this.cursor) continue;
      const p = centerOf(g.edgeInfo[e]);
      const ax = p.x - from.x;
      const ay = p.y - from.y;
      const along = ax * dx + ay * dy;
      if (along <= 0.01) continue;
      const side = Math.abs(ax * dy - ay * dx);
      const score = along + side * 3;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  _drawCursor() {
    if (!this.cursorEl) return;
    if (this.cursor < 0 || !this.showCursor) { this.cursorEl.classList.remove('on'); return; }
    const info = this.grid.edgeInfo[this.cursor];
    const p = centerOf(info);
    const w = info.dir === 'h' ? 0.86 : 0.34;
    const h = info.dir === 'h' ? 0.34 : 0.86;
    this.cursorEl.setAttribute('x', p.x - w / 2);
    this.cursorEl.setAttribute('y', p.y - h / 2);
    this.cursorEl.setAttribute('width', w);
    this.cursorEl.setAttribute('height', h);
    this.cursorEl.classList.add('on');
  }

  /** 画面座標から最も近い辺を求める。遠すぎるときは -1。 */
  _pick(ev) {
    const g = this.grid;
    if (!g) return -1;
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    const vb = this.svg.viewBox.baseVal;
    const bx = vb.x + ((ev.clientX - rect.left) / rect.width) * vb.width;
    const by = vb.y + ((ev.clientY - rect.top) / rect.height) * vb.height;

    let best = -1;
    let bestDist = PICK_RADIUS * PICK_RADIUS;

    // 近くにある水平辺の候補
    const hr = Math.round(by);
    const hc = Math.floor(bx);
    if (hr >= 0 && hr <= g.rows && hc >= 0 && hc < g.cols) {
      const d = sq(bx - (hc + 0.5)) + sq(by - hr);
      if (d < bestDist) { bestDist = d; best = g.h(hr, hc); }
    }
    // 近くにある垂直辺の候補
    const vr = Math.floor(by);
    const vc = Math.round(bx);
    if (vr >= 0 && vr < g.rows && vc >= 0 && vc <= g.cols) {
      const d = sq(bx - vc) + sq(by - (vr + 0.5));
      if (d < bestDist) { bestDist = d; best = g.v(vr, vc); }
    }
    return best;
  }
}

/**
 * タップするたびの値の移り変わり。
 *   線モード: 空白 → 線 → × → 空白
 *   ×モード : 空白 → × → 線 → 空白
 */
function nextValue(v, mode) {
  const first = mode === 'cross' ? CROSS : LINE;
  const second = mode === 'cross' ? LINE : CROSS;
  if (v === UNKNOWN) return first;
  if (v === first) return second;
  return UNKNOWN;
}

function endpointsOf(info) {
  return info.dir === 'h'
    ? [info.c, info.r, info.c + 1, info.r]
    : [info.c, info.r, info.c, info.r + 1];
}

function centerOf(info) {
  return info.dir === 'h'
    ? { x: info.c + 0.5, y: info.r }
    : { x: info.c, y: info.r + 0.5 };
}

function sq(x) { return x * x; }
