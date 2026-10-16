/**
 * 盤面の描画と入力。SVG を 1 度だけ組み立て、以降は変化した辺だけ更新する。
 */

import { getGrid, UNKNOWN, LINE, CROSS } from '../core/grid.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD = 0.62;          // 盤面まわりの余白 (マス単位)
const PICK_RADIUS = 0.46;  // これより遠いクリックは無視する
const TAP_SLOP = 8;        // これ以上（px）指が動いたら、タップではなく移動とみなす

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
    this.hintValue = UNKNOWN; // ヒントが示す印（線か ×）。分からなければ位置だけ示す
    // ヒントの根拠（なぜそこが決まるのか）を示す場所
    this.focusCells = new Set();
    this.focusVertices = new Set();
    this.focusEdges = new Set();
    // 背理法のヒントで「仮定するとこうなる」という印（盤面にはまだ無い）
    this.trialMarks = new Map();
    // 点線のカーソルは、キーボードで操作しているときだけ出す
    this.showCursor = false;
    this.showErrors = true;
    this.fadeDone = true;   // まわりの辺が全部決まり、線の数が数字と同じなら薄くする
    this.fadeLines = true;  // 線の数が数字と同じになったら薄くする（× を付け終わっていなくても）
    this.inputMode = 'line'; // 'line' か 'cross'。タップで最初に付く印が変わる
    this.flipMode = false;   // ⌘ を押しているあいだは true（クリックの印を入れ替える）
    this.cursor = -1;
    this._pointers = new Map(); // 盤面に触れている指（pointerId → 位置）
    this._gesture = null;       // いまの操作：tap / pan / slide / pinch
    this.zoom = { scale: 1, cx: 0, cy: 0 };
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
    this.trialMarks.clear();
    this.cursor = -1;
    this.showCursor = false;
    this._build();
    this.resetZoom();
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
      const trial = want === UNKNOWN && !isHint ? (this.trialMarks.get(e) ?? UNKNOWN) : UNKNOWN;
      const key = want + (isHint ? 8 : 0) + (this.focusEdges.has(e) ? 16 : 0) + trial * 32;
      if (this.rendered[e] === key) continue;
      this.rendered[e] = key;
      const ln = this.edgeEls[e];
      const isEvidence = this.focusEdges.has(e);
      ln.classList.toggle('line', want === LINE);
      const hintMark = want !== UNKNOWN
        ? want
        : (this.hintValue instanceof Map ? (this.hintValue.get(e) ?? UNKNOWN) : this.hintValue);
      ln.classList.toggle('hint', isHint && hintMark !== CROSS);
      ln.classList.toggle('evidence', isEvidence && want === LINE);
      ln.classList.toggle('trial', trial === LINE);
      this.crossEls[e].classList.toggle('on', want === CROSS);
      this.crossEls[e].classList.toggle('hint', isHint && hintMark === CROSS);
      this.crossEls[e].classList.toggle('evidence', isEvidence && want === CROSS);
      this.crossEls[e].classList.toggle('trial', trial === CROSS);
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
      // 線の数で薄くするのは 1〜3 だけ（0 は最初から揃っているので、まわりに × を付け終わってから薄くする）
      const fadeNow = (this.fadeLines && clue > 0) || ((this.fadeDone || this.fadeLines) && unknown === 0);
      el.classList.toggle('done', !bad && lines === clue && fadeNow);
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

  /** value は全部の辺に共通の印か、辺 → 印の Map（定石のように辺ごとに違うとき）。 */
  setHints(edges, focus, value = UNKNOWN) {
    this.hintEdges = new Set(edges);
    this.hintValue = value;
    this.focusCells = new Set(focus?.cells ?? []);
    this.focusVertices = new Set(focus?.vertices ?? []);
    this.focusEdges = new Set(focus?.edges ?? []);
    this.trialMarks = new Map((focus?.trial ?? []).map((t) => [t.edge, t.value]));
    this.rendered.fill(-1);
    this.refresh();
  }

  clearHints() {
    if (this.hintEdges.size === 0 && this.focusCells.size === 0 && this.focusVertices.size === 0) return;
    this.hintEdges.clear();
    this.focusCells.clear();
    this.focusVertices.clear();
    this.focusEdges.clear();
    this.trialMarks.clear();
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

    // ⌘ を押しているあいだは、クリックで付く印を一時的に入れ替える（線モードなら ×、×モードなら線）。
    // マウスの形もその印にして、押しているのが分かるようにする
    const setFlip = (on) => {
      if (on === this.flipMode) return;
      this.flipMode = on;
      this.updatePointerLook();
    };
    window.addEventListener('keydown', (ev) => { if (ev.key === 'Meta') setFlip(true); });
    window.addEventListener('keyup', (ev) => { if (ev.key === 'Meta') setFlip(false); });
    window.addEventListener('blur', () => setFlip(false));
    // 窓の外で ⌘ を離した・押したときも、盤面に戻ったところで合わせる
    svg.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') setFlip(ev.metaKey); });

    // 指 1 本で触って、ほとんど動かさずに離したら「タップ」として印を付ける。
    // 動かしたら（拡大中なら）盤面を動かす。指 2 本ならピンチで拡大・縮小する。
    // 印は指を離したときに付けるので、ピンチや移動のつもりが印になってしまうことはない。
    svg.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 && ev.button !== 2) return;
      ev.preventDefault();
      // preventDefault でフォーカスが移らないので明示的に当てる。
      // 盤面をクリックしたあと、そのまま矢印キーで操作できるようにするため。
      svg.focus({ preventScroll: true });
      svg.setPointerCapture(ev.pointerId);
      this._pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this._pointers.size === 2) {
        const [p, q] = [...this._pointers.values()];
        this._gesture = {
          type: 'pinch',
          dist: Math.hypot(p.x - q.x, p.y - q.y) || 1,
          scale: this.zoom.scale,
          anchor: this._toBoard((p.x + q.x) / 2, (p.y + q.y) / 2),
        };
        return;
      }
      if (this._pointers.size > 2) return;
      this._gesture = {
        type: 'tap',
        id: ev.pointerId,
        x: ev.clientX,
        y: ev.clientY,
        secondary: ev.button === 2 || ev.ctrlKey,
        flip: ev.metaKey,
        center: { x: this.zoom.cx, y: this.zoom.cy },
      };
    });

    svg.addEventListener('pointermove', (ev) => {
      if (!this._pointers.has(ev.pointerId)) return;
      this._pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const g = this._gesture;
      if (!g) return;
      if (g.type === 'pinch' && this._pointers.size >= 2) {
        const [p, q] = [...this._pointers.values()];
        const scale = g.scale * (Math.hypot(p.x - q.x, p.y - q.y) / g.dist);
        // ピンチを始めた点が、指のまん中にとどまるように拡大する
        this._zoomAround(scale, g.anchor, (p.x + q.x) / 2, (p.y + q.y) / 2);
        return;
      }
      if (g.id !== ev.pointerId) return;
      const dx = ev.clientX - g.x;
      const dy = ev.clientY - g.y;
      if (g.type === 'tap' && Math.hypot(dx, dy) > TAP_SLOP) g.type = this.zoom.scale > 1 ? 'pan' : 'slide';
      if (g.type === 'pan') {
        const rect = this._drawnRect();
        const unit = svg.viewBox.baseVal.width / (rect.width || 1);
        this.setZoom(this.zoom.scale, g.center.x - dx * unit, g.center.y - dy * unit);
      }
    });

    const end = (ev) => {
      if (!this._pointers.has(ev.pointerId)) return;
      const g = this._gesture;
      this._pointers.delete(ev.pointerId);
      if (svg.hasPointerCapture?.(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
      // 拡大していないときになぞった場合は、最初に触れた 1 辺だけに印を付ける（これまでどおり）
      const tapLike = g && (g.type === 'tap' || g.type === 'slide');
      if (tapLike && g.id === ev.pointerId && ev.type === 'pointerup') this._tap(g);
      // ピンチのあとに残った指を離しても、タップにはしない
      this._gesture = this._pointers.size === 0 ? null : { type: 'done' };
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    // PC: Ctrl + ホイール（トラックパッドのピンチ）で拡大・縮小、拡大中はホイールで移動
    svg.addEventListener('wheel', (ev) => {
      if (ev.ctrlKey) {
        ev.preventDefault();
        const anchor = this._toBoard(ev.clientX, ev.clientY);
        this._zoomAround(this.zoom.scale * Math.exp(-ev.deltaY * 0.01), anchor, ev.clientX, ev.clientY);
      } else if (this.zoom.scale > 1) {
        ev.preventDefault();
        const rect = this._drawnRect();
        const unit = svg.viewBox.baseVal.width / (rect.width || 1);
        this.setZoom(this.zoom.scale, this.zoom.cx + ev.deltaX * unit, this.zoom.cy + ev.deltaY * unit);
      }
    }, { passive: false });

    svg.addEventListener('keydown', (ev) => this._onKey(ev));
    svg.addEventListener('blur', () => {
      this.showCursor = false;
      this._drawCursor();
    });
  }

  /** タップした場所の辺に印を付ける（右クリック・Ctrl+クリックは主役でない方の印）。 */
  _tap(g) {
    const e = this._pickAt(g.x, g.y);
    if (e < 0) return;
    const current = this.state[e];
    // 右クリック (Ctrl+クリック) は、いまのモードで主役でない方の印を付け外しする
    const secondary = this.inputMode === 'cross' ? LINE : CROSS;
    const mode = g.flip ? (this.inputMode === 'cross' ? 'line' : 'cross') : this.inputMode;
    const value = g.secondary
      ? (current === secondary ? UNKNOWN : secondary)
      : nextValue(current, mode);
    // 指やマウスで触ったときは点線を出さない（キーボード再開位置だけ覚える）
    this.cursor = e;
    this.showCursor = false;
    this._drawCursor();
    this.handlers.onPaint(e, value);
    this.handlers.onStrokeEnd();
  }

  /** ⌘ を押しているあいだのマウスの形（クリックで付く印）を、いまのモードに合わせる。 */
  updatePointerLook() {
    const mark = this.flipMode ? (this.inputMode === 'cross' ? 'line' : 'cross') : null;
    this.svg.classList.toggle('pointer-line', mark === 'line');
    this.svg.classList.toggle('pointer-cross', mark === 'cross');
  }

  /* ---------------- 拡大・縮小 ---------------- */

  /** 盤面全体が見えるときの範囲（盤面の座標）。 */
  _baseBox() {
    const { rows, cols } = this.puzzle;
    return { x: -PAD, y: -PAD, w: cols + PAD * 2, h: rows + PAD * 2 };
  }

  /** どこまで拡大できるか。小さな盤は拡大しない（5 マスぶんが画面いっぱいになるまで）。 */
  maxScale() {
    if (!this.puzzle) return 1;
    return Math.max(1, Math.min(4, Math.max(this.puzzle.rows, this.puzzle.cols) / 5));
  }

  /** 倍率と、画面のまん中に来る点（盤面の座標）を決める。はみ出さないよう寄せる。 */
  setZoom(scale, cx, cy) {
    if (!this.puzzle) return;
    const b = this._baseBox();
    const s = Math.max(1, Math.min(this.maxScale(), scale));
    const w = b.w / s;
    const h = b.h / s;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const x = clamp(cx, b.x + w / 2, b.x + b.w - w / 2);
    const y = clamp(cy, b.y + h / 2, b.y + b.h - h / 2);
    const changed = s !== this.zoom.scale;
    this.zoom = { scale: s, cx: x, cy: y };
    this.svg.setAttribute('viewBox', `${x - w / 2} ${y - h / 2} ${w} ${h}`);
    this.svg.classList.toggle('zoomed', s > 1);
    if (changed) this.handlers.onZoomChange?.(s, this.maxScale());
  }

  /** 盤面の点 anchor が、画面の (sx, sy) に来るように倍率を変える。 */
  _zoomAround(scale, anchor, sx, sy) {
    const rect = this._drawnRect();
    const b = this._baseBox();
    const s = Math.max(1, Math.min(this.maxScale(), scale));
    const w = b.w / s;
    const h = b.h / s;
    const fx = (sx - rect.left) / (rect.width || 1);
    const fy = (sy - rect.top) / (rect.height || 1);
    this.setZoom(s, anchor.x - fx * w + w / 2, anchor.y - fy * h + h / 2);
  }

  /** ボタンから：いまの画面のまん中を中心に、factor 倍する。 */
  zoomBy(factor) {
    this.setZoom(this.zoom.scale * factor, this.zoom.cx, this.zoom.cy);
  }

  resetZoom() {
    const b = this._baseBox();
    this.setZoom(1, b.x + b.w / 2, b.y + b.h / 2);
  }

  /** 拡大中に辺が画面の外にあれば、その辺が見える位置まで動かす。 */
  ensureVisible(edge) {
    if (!this.grid || this.zoom.scale <= 1 || edge < 0) return;
    const p = centerOf(this.grid.edgeInfo[edge]);
    const vb = this.svg.viewBox.baseVal;
    const m = 0.7;
    if (p.x < vb.x + m || p.x > vb.x + vb.width - m || p.y < vb.y + m || p.y > vb.y + vb.height - m) {
      this.setZoom(this.zoom.scale, p.x, p.y);
    }
  }

  /**
   * 盤面が実際に描かれている画面上の四角。
   * 高さの上限で <svg> の枠が盤より横長（縦長）になると、盤は枠のまん中に縮めて描かれるので、
   * 枠そのもの（getBoundingClientRect）ではなく、こちらで座標を合わせる。
   */
  _drawnRect() {
    const rect = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;
    if (!rect.width || !rect.height || !vb.width || !vb.height) return rect;
    const k = Math.min(rect.width / vb.width, rect.height / vb.height);
    const width = vb.width * k;
    const height = vb.height * k;
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top + (rect.height - height) / 2,
      width,
      height,
    };
  }

  /** 画面の座標を盤面の座標にする。 */
  _toBoard(clientX, clientY) {
    const rect = this._drawnRect();
    const vb = this.svg.viewBox.baseVal;
    return {
      x: vb.x + ((clientX - rect.left) / (rect.width || 1)) * vb.width,
      y: vb.y + ((clientY - rect.top) / (rect.height || 1)) * vb.height,
    };
  }

  _onKey(ev) {
    if (!this.grid) return;
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (dirs[ev.key]) {
      ev.preventDefault();
      this.cursor = this._moveCursor(dirs[ev.key]);
      this.showCursor = true;
      this.ensureVisible(this.cursor);
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
  _pickAt(clientX, clientY) {
    const g = this.grid;
    if (!g) return -1;
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    const { x: bx, y: by } = this._toBoard(clientX, clientY);

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
