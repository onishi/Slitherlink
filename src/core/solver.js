/**
 * 論理ソルバ。
 *
 * 「当てずっぽう無しで解けるか」を判定するのが目的なので、
 * 使うのは次の推論だけ:
 *   R1 数字の充足    : 周囲の線が数字に達したら残りは ×、足りない分が確定なら残りは線
 *   R2 頂点の次数    : 各頂点の線は 0 本か 2 本
 *   R3 閉路の禁止    : まだ全体が完成しないのにループを閉じる辺は ×
 *   R4 背理法(深さ d): ある辺を仮定すると R1〜R3 だけで矛盾 → 反対の値に確定
 *
 * R4 の深さ 0 = 純粋な伝播のみ。深さ 1 で「3 が隣り合う」「角の 1」などの
 * 定石パターンはすべて導ける。
 */

import { UNKNOWN, LINE, CROSS } from './grid.js';

export { UNKNOWN, LINE, CROSS };

export const RULE_LABELS = {
  clue_full: '数字の本数がそろったので残りは×',
  clue_rest: '残りの辺をすべて使わないと数字に届かない',
  vertex_two: '交点にはすでに線が2本あるので残りは×',
  vertex_pair: '線の端は必ずもう1本つながる',
  vertex_dead: 'ここに線を引くと行き止まりになる',
  loop_closed: 'ここで輪を閉じると小さな輪ができてしまう',
  loop_done: '輪が完成したので残りの辺はすべて×',
  assume_line: 'ここに線を引くと矛盾する（背理法）',
  assume_cross: 'ここを×にすると矛盾する（背理法）',
};

class DSU {
  constructor(n) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
    this.rank = new Uint8Array(n);
  }
  clone() {
    const d = Object.create(DSU.prototype);
    d.parent = this.parent.slice();
    d.rank = this.rank.slice();
    return d;
  }
  find(x) {
    const p = this.parent;
    let root = x;
    while (p[root] !== root) root = p[root];
    while (p[x] !== root) {
      const next = p[x];
      p[x] = root;
      x = next;
    }
    return root;
  }
  union(a, b) {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return false;
    if (this.rank[a] < this.rank[b]) { const t = a; a = b; b = t; }
    this.parent[b] = a;
    if (this.rank[a] === this.rank[b]) this.rank[a]++;
    return true;
  }
}

export class SolveState {
  /**
   * @param {object} grid
   * @param {Int8Array} clues マスごとの数字。-1 は空白。
   */
  constructor(grid, clues, trackReasons = false) {
    const { edgeCount, vertexCount, cellCount } = grid;
    this.grid = grid;
    this.clues = clues;
    this.edges = new Int8Array(edgeCount);
    this.cellLine = new Int8Array(cellCount);
    this.cellUnknown = new Int8Array(cellCount).fill(4);
    this.vertexLine = new Int8Array(vertexCount);
    this.vertexUnknown = new Int8Array(vertexCount);
    for (let v = 0; v < vertexCount; v++) this.vertexUnknown[v] = grid.vertexEdges[v].length;
    this.dsu = new DSU(vertexCount);
    this.openEnds = 0;       // 次数 1 の頂点の数 (線の端)
    this.unsatisfied = 0;    // まだ数字に達していない手がかりマスの数
    // clue 0 のマスは最初から満たされている
    for (let i = 0; i < cellCount; i++) if (clues[i] > 0) this.unsatisfied++;
    this.lineCount = 0;
    this.unknownCount = edgeCount;
    this.contradiction = false;
    this.loopRuleAt = -1; // 最後に R3 を走らせたときの線の本数
    this.queueCells = [];
    this.queueVertices = [];
    this.reasons = trackReasons ? new Array(edgeCount).fill(null) : null;
  }

  clone() {
    const s = Object.create(SolveState.prototype);
    s.grid = this.grid;
    s.clues = this.clues;
    s.edges = this.edges.slice();
    s.cellLine = this.cellLine.slice();
    s.cellUnknown = this.cellUnknown.slice();
    s.vertexLine = this.vertexLine.slice();
    s.vertexUnknown = this.vertexUnknown.slice();
    s.dsu = this.dsu.clone();
    s.openEnds = this.openEnds;
    s.unsatisfied = this.unsatisfied;
    s.lineCount = this.lineCount;
    s.unknownCount = this.unknownCount;
    s.contradiction = this.contradiction;
    s.loopRuleAt = this.loopRuleAt;
    s.queueCells = this.queueCells.slice();
    s.queueVertices = this.queueVertices.slice();
    s.reasons = this.reasons ? this.reasons.slice() : null;
    return s;
  }

  /** 辺の値を確定させる。矛盾したら false。 */
  setEdge(e, value, reason) {
    if (this.edges[e] === value) return !this.contradiction;
    if (this.edges[e] !== UNKNOWN) {
      this.contradiction = true;
      return false;
    }
    const g = this.grid;
    this.edges[e] = value;
    this.unknownCount--;
    if (this.reasons && reason && !this.reasons[e]) this.reasons[e] = reason;

    for (const cell of g.edgeCells[e]) {
      this.cellUnknown[cell]--;
      if (value === LINE) {
        this.cellLine[cell]++;
        if (this.clues[cell] >= 0 && this.cellLine[cell] === this.clues[cell]) this.unsatisfied--;
        if (this.clues[cell] >= 0 && this.cellLine[cell] === this.clues[cell] + 1) this.unsatisfied++;
      }
      this.queueCells.push(cell);
    }

    for (let k = 0; k < 2; k++) {
      const v = g.edgeEnds[e * 2 + k];
      this.vertexUnknown[v]--;
      if (value === LINE) {
        const before = this.vertexLine[v];
        this.vertexLine[v]++;
        if (before === 0) this.openEnds++;
        else if (before === 1) this.openEnds--;
      }
      this.queueVertices.push(v);
    }

    if (value === LINE) {
      this.lineCount++;
      const a = g.edgeEnds[e * 2];
      const b = g.edgeEnds[e * 2 + 1];
      if (!this.dsu.union(a, b)) {
        // ループが閉じた。全体の完成でなければ矛盾。
        if (this.openEnds !== 0 || this.unsatisfied !== 0 || this.lineCount === 0) {
          this.contradiction = true;
          return false;
        }
      }
    }
    return true;
  }

  /** 各マス・各頂点の局所ルールを収束するまで適用する。 */
  propagate() {
    const g = this.grid;
    while (!this.contradiction) {
      while (this.queueCells.length || this.queueVertices.length) {
        if (this.contradiction) return false;
        if (this.queueCells.length) {
          const cell = this.queueCells.pop();
          const clue = this.clues[cell];
          if (clue < 0) continue;
          const line = this.cellLine[cell];
          const unknown = this.cellUnknown[cell];
          if (line > clue || line + unknown < clue) { this.contradiction = true; return false; }
          if (unknown > 0 && line === clue) {
            for (let k = 0; k < 4; k++) {
              const e = g.cellEdges[cell * 4 + k];
              if (this.edges[e] === UNKNOWN && !this.setEdge(e, CROSS, 'clue_full')) return false;
            }
          } else if (unknown > 0 && line + unknown === clue) {
            for (let k = 0; k < 4; k++) {
              const e = g.cellEdges[cell * 4 + k];
              if (this.edges[e] === UNKNOWN && !this.setEdge(e, LINE, 'clue_rest')) return false;
            }
          }
          continue;
        }
        const v = this.queueVertices.pop();
        const line = this.vertexLine[v];
        const unknown = this.vertexUnknown[v];
        if (line > 2) { this.contradiction = true; return false; }
        if (line === 1 && unknown === 0) { this.contradiction = true; return false; }
        if (line === 2 && unknown > 0) {
          for (const e of g.vertexEdges[v]) {
            if (this.edges[e] === UNKNOWN && !this.setEdge(e, CROSS, 'vertex_two')) return false;
          }
        } else if (line === 1 && unknown === 1) {
          for (const e of g.vertexEdges[v]) {
            if (this.edges[e] === UNKNOWN && !this.setEdge(e, LINE, 'vertex_pair')) return false;
          }
        } else if (line === 0 && unknown === 1) {
          for (const e of g.vertexEdges[v]) {
            if (this.edges[e] === UNKNOWN && !this.setEdge(e, CROSS, 'vertex_dead')) return false;
          }
        }
      }
      if (!this.applyLoopRule()) return false;
      if (!this.applyCompletionRule()) return false;
      if (!this.queueCells.length && !this.queueVertices.length) break;
    }
    return !this.contradiction;
  }

  /** R3: いま線にすると小さな輪ができてしまう辺を × にする。 */
  applyLoopRule() {
    if (this.lineCount === 0) return true;
    // DSU は線が増えたときしか変化しない。変化が無ければ走査を省く。
    if (this.loopRuleAt === this.lineCount) return true;
    this.loopRuleAt = this.lineCount;
    const g = this.grid;
    for (let e = 0; e < g.edgeCount; e++) {
      if (this.edges[e] !== UNKNOWN) continue;
      const a = g.edgeEnds[e * 2];
      const b = g.edgeEnds[e * 2 + 1];
      if (this.dsu.find(a) !== this.dsu.find(b)) continue;
      // この辺を線にすると輪が閉じる。完成形になるときだけ許される。
      const closesAll =
        this.openEnds === 2 &&
        this.vertexLine[a] === 1 &&
        this.vertexLine[b] === 1 &&
        this.wouldSatisfyAllClues(e);
      if (!closesAll) {
        if (!this.setEdge(e, CROSS, 'loop_closed')) return false;
      }
    }
    return true;
  }

  /**
   * 輪がすでに閉じていてすべての数字が満たされているなら、
   * 残りの辺は全部 × (2 つめの輪は作れないため)。
   */
  applyCompletionRule() {
    if (this.unknownCount === 0) return true;
    if (this.lineCount === 0 || this.openEnds !== 0 || this.unsatisfied !== 0) return true;
    for (let e = 0; e < this.grid.edgeCount; e++) {
      if (this.edges[e] === UNKNOWN && !this.setEdge(e, CROSS, 'loop_done')) return false;
    }
    return true;
  }

  /** 辺 e を線にしたとき、すべての数字が過不足なく満たされるか。 */
  wouldSatisfyAllClues(e) {
    let pending = this.unsatisfied;
    for (const cell of this.grid.edgeCells[e]) {
      const clue = this.clues[cell];
      if (clue < 0) continue;
      if (this.cellLine[cell] + 1 !== clue) return false;
      pending--;
    }
    return pending === 0;
  }

  /** すべての辺が確定し、正しい 1 本の輪になっているか。 */
  isComplete() {
    if (this.contradiction || this.unknownCount !== 0) return false;
    if (this.openEnds !== 0 || this.unsatisfied !== 0 || this.lineCount === 0) return false;
    const g = this.grid;
    // 線の辺がひとつの連結成分になっているか
    let root = -1;
    for (let v = 0; v < g.vertexCount; v++) {
      if (this.vertexLine[v] === 0) continue;
      const r = this.dsu.find(v);
      if (root === -1) root = r;
      else if (r !== root) return false;
    }
    return root !== -1;
  }

  toEdgeArray() {
    return this.edges.slice();
  }
}

/**
 * 与えられた問題を論理推論だけで解く。
 * @param {object} grid
 * @param {Int8Array} clues
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=1] 背理法の深さ
 * @param {Int8Array} [opts.initial] 既知の辺 (ヒント機能で使う)
 * @returns {{status:'solved'|'stuck'|'contradiction', state:SolveState}}
 */
export function solveLogical(grid, clues, opts = {}) {
  const maxDepth = opts.maxDepth ?? 1;
  const state = new SolveState(grid, clues, opts.trackReasons === true);
  if (opts.initial) {
    for (let e = 0; e < grid.edgeCount; e++) {
      const val = opts.initial[e];
      if (val === LINE || val === CROSS) {
        if (!state.setEdge(e, val, 'given')) return { status: 'contradiction', state };
      }
    }
  }
  for (let cell = 0; cell < grid.cellCount; cell++) state.queueCells.push(cell);
  for (let v = 0; v < grid.vertexCount; v++) state.queueVertices.push(v);

  if (!state.propagate()) return { status: 'contradiction', state };
  if (state.isComplete()) return { status: 'solved', state };

  if (maxDepth > 0) {
    const budget = { nodes: opts.budget ?? 400000 };
    // 浅い推論を優先し、行き詰まったときだけ深い背理法に切り替える。
    let depth = 1;
    while (budget.nodes > 0) {
      const progressed = trialPass(state, depth, budget);
      if (state.contradiction) return { status: 'contradiction', state };
      if (state.isComplete()) return { status: 'solved', state };
      if (progressed) { depth = 1; continue; }
      if (depth >= maxDepth) break;
      depth++;
    }
  }
  return { status: state.isComplete() ? 'solved' : 'stuck', state };
}

/**
 * 背理法を 1 巡ぶん適用する。1 つでも確定できたら true。
 * 仮定する辺は「すでに確定した辺と頂点を共有する辺」に限定して探索量を抑える。
 */
function trialPass(state, depth, budget) {
  const g = state.grid;
  let progressed = false;
  const candidates = frontierEdges(state);
  for (const e of candidates) {
    if (state.edges[e] !== UNKNOWN) continue;
    if (budget.nodes <= 0) return progressed;

    budget.nodes--;
    const tryLine = state.clone();
    let lineOk = tryLine.setEdge(e, LINE, 'trial') && tryLine.propagate();
    if (lineOk && depth > 1 && !tryLine.isComplete()) {
      lineOk = deepCheck(tryLine, depth - 1, budget);
    }
    if (!lineOk) {
      if (!state.setEdge(e, CROSS, 'assume_line') || !state.propagate()) return true;
      progressed = true;
      continue;
    }

    budget.nodes--;
    const tryCross = state.clone();
    let crossOk = tryCross.setEdge(e, CROSS, 'trial') && tryCross.propagate();
    if (crossOk && depth > 1 && !tryCross.isComplete()) {
      crossOk = deepCheck(tryCross, depth - 1, budget);
    }
    if (!crossOk) {
      if (!state.setEdge(e, LINE, 'assume_cross') || !state.propagate()) return true;
      progressed = true;
      continue;
    }

  }
  return progressed;
}

const DEEP_CANDIDATE_LIMIT = 20;

/** 深さ 2 以上の背理法: 仮定した状態からさらに矛盾を掘る。 */
function deepCheck(state, depth, budget) {
  const candidates = frontierEdges(state);
  let tried = 0;
  for (const e of candidates) {
    if (tried >= DEEP_CANDIDATE_LIMIT) break;
    if (state.edges[e] !== UNKNOWN) continue;
    if (budget.nodes <= 0) return true;
    tried++;
    budget.nodes--;
    const a = state.clone();
    const aOk = a.setEdge(e, LINE, 'trial') && a.propagate();
    budget.nodes--;
    const b = state.clone();
    const bOk = b.setEdge(e, CROSS, 'trial') && b.propagate();
    if (!aOk && !bOk) return false;              // どちらでも矛盾 → 元の仮定が誤り
    if (!aOk) {
      if (!state.setEdge(e, CROSS, 'assume_line') || !state.propagate()) return false;
    } else if (!bOk) {
      if (!state.setEdge(e, LINE, 'assume_cross') || !state.propagate()) return false;
    }
  }
  return true;
}

/** 確定済みの辺に隣接する未確定辺 (= 推論が進みやすい場所) を集める。 */
function frontierEdges(state) {
  const g = state.grid;
  const seen = new Uint8Array(g.edgeCount);
  const list = [];
  for (let v = 0; v < g.vertexCount; v++) {
    const edges = g.vertexEdges[v];
    let decided = 0;
    for (const e of edges) if (state.edges[e] !== UNKNOWN) decided++;
    if (decided === 0) continue;
    for (const e of edges) {
      if (state.edges[e] === UNKNOWN && !seen[e]) {
        seen[e] = 1;
        list.push(e);
      }
    }
  }
  if (list.length === 0) {
    for (let e = 0; e < g.edgeCount; e++) if (state.edges[e] === UNKNOWN) list.push(e);
  }
  return list;
}

/**
 * 総当たり (バックトラック) で解の個数を数える。作問と定石の検証用。
 * @param {Int8Array} [initial] 既知の辺。これを満たす解だけを数える。
 * @returns {number} 見つかった解の数 (limit で打ち切り)
 */
export function countSolutions(grid, clues, limit = 2, initial = null) {
  const root = new SolveState(grid, clues, false);
  if (initial) {
    for (let e = 0; e < grid.edgeCount; e++) {
      const val = initial[e];
      if (val === LINE || val === CROSS) {
        if (!root.setEdge(e, val, 'given')) return 0;
      }
    }
  }
  for (let cell = 0; cell < grid.cellCount; cell++) root.queueCells.push(cell);
  for (let v = 0; v < grid.vertexCount; v++) root.queueVertices.push(v);
  if (!root.propagate()) return 0;
  let found = 0;
  const stack = [root];
  while (stack.length && found < limit) {
    const s = stack.pop();
    if (s.isComplete()) { found++; continue; }
    // 最も情報量の多い未確定辺を選ぶ
    let pick = -1;
    const frontier = frontierEdges(s);
    for (const e of frontier) { if (s.edges[e] === UNKNOWN) { pick = e; break; } }
    if (pick === -1) continue;
    for (const val of [LINE, CROSS]) {
      const next = s.clone();
      if (next.setEdge(pick, val, 'search') && next.propagate()) stack.push(next);
    }
  }
  return found;
}
