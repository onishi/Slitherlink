/**
 * 論理ソルバ。
 *
 * 「当てずっぽう無しで解けるか」を判定するのが目的なので、
 * 使うのは次の推論だけ:
 *   R1 数字の充足    : 周囲の線が数字に達したら残りは ×、足りない分が確定なら残りは線
 *   R2 頂点の次数    : 各頂点の線は 0 本か 2 本
 *   R3 閉路の禁止    : まだ全体が完成しないのにループを閉じる辺は ×
 *   R5 内側と外側    : どのマスも輪の内側か外側。線をまたぐと入れ替わり、× をまたぐと同じまま。
 *                      2 つのマスの関係が、確定した辺をたどって分かっていれば、その間の辺も決まる
 *                      （盤の外は外側。大きな盤の問題では、これが要ることがある）
 *   R4 背理法(深さ d): ある辺を仮定すると R1〜R3, R5 だけで矛盾 → 反対の値に確定
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
  parity: '両側のマスが輪の内側か外側かが、ほかの線と×から分かっている',
  assume_line: 'ここに線を引くと矛盾する（背理法）',
  assume_cross: 'ここを×にすると矛盾する（背理法）',
};

class DSU {
  /** parent と rank は、呼び出し側がまとめて確保した配列の一部（複製を安くするため）。 */
  constructor(parent, rank) {
    this.parent = parent;
    this.rank = rank;
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
    // 背理法では状態を何度も複製する。配列を 1 つずつ作ると確保が重いので、
    // 8 ビットと 32 ビットの 2 本にまとめて確保し、それぞれの配列はその一部を見る
    const nodes = cellCount + 1;
    this.mem8 = new Int8Array(edgeCount + 2 * cellCount + 2 * vertexCount + vertexCount + nodes);
    this.mem32 = new Int32Array(vertexCount + 3 * nodes);
    this.attach();
    this.cellUnknown.fill(4);
    for (let v = 0; v < vertexCount; v++) this.vertexUnknown[v] = grid.vertexEdges[v].length;
    for (let v = 0; v < vertexCount; v++) this.dsu.parent[v] = v;
    // R5：マス（と盤の外 = cellCount 番）の内外の関係。親との関係（0 同じ側・1 反対側）と、
    // 同じ組のマスをつなぐ輪状のリスト（組を合わせたとき、決まる辺を探すため）
    this.psize.fill(1);
    for (let i = 0; i < nodes; i++) { this.ppar[i] = i; this.pnext[i] = i; }
    this.queueParity = [];
    this.openEnds = 0;       // 次数 1 の頂点の数 (線の端)
    this.unsatisfied = 0;    // まだ数字に達していない手がかりマスの数
    // clue 0 のマスは最初から満たされている
    for (let i = 0; i < cellCount; i++) if (clues[i] > 0) this.unsatisfied++;
    this.lineCount = 0;
    this.unknownCount = edgeCount;
    this.contradiction = false;
    this.clash = null; // どこで矛盾したか（ヒントの説明に使う）
    this.loopRuleAt = -1; // 最後に R3 を走らせたときの線の本数
    this.queueCells = [];
    this.queueVertices = [];
    this.reasons = trackReasons ? new Array(edgeCount).fill(null) : null;
    // 理由を記録するときは、確定した順番も残す（根拠の連鎖をたどるため）
    this.order = trackReasons ? new Int32Array(edgeCount).fill(-1) : null;
    this.seq = 0;
  }

  /** mem8 と mem32 の中に、各配列の置き場所を割り当てる。 */
  attach() {
    const { edgeCount, vertexCount, cellCount } = this.grid;
    const nodes = cellCount + 1;
    let at = 0;
    const take8 = (n) => this.mem8.subarray(at, (at += n));
    this.edges = take8(edgeCount);
    this.cellLine = take8(cellCount);
    this.cellUnknown = take8(cellCount);
    this.vertexLine = take8(vertexCount);
    this.vertexUnknown = take8(vertexCount);
    const rank = take8(vertexCount);
    this.prel = take8(nodes);
    at = 0;
    const take32 = (n) => this.mem32.subarray(at, (at += n));
    this.dsu = new DSU(take32(vertexCount), rank);
    this.ppar = take32(nodes);
    this.psize = take32(nodes);
    this.pnext = take32(nodes);
  }

  clone() {
    const s = Object.create(SolveState.prototype);
    s.grid = this.grid;
    s.clues = this.clues;
    s.mem8 = this.mem8.slice();
    s.mem32 = this.mem32.slice();
    s.attach();
    s.queueParity = this.queueParity.slice();
    s.openEnds = this.openEnds;
    s.unsatisfied = this.unsatisfied;
    s.lineCount = this.lineCount;
    s.unknownCount = this.unknownCount;
    s.contradiction = this.contradiction;
    s.clash = this.clash;
    s.loopRuleAt = this.loopRuleAt;
    s.queueCells = this.queueCells.slice();
    s.queueVertices = this.queueVertices.slice();
    s.reasons = this.reasons ? this.reasons.slice() : null;
    s.order = this.order ? this.order.slice() : null;
    s.seq = this.seq;
    return s;
  }

  /** 辺の値を確定させる。矛盾したら false。 */
  setEdge(e, value, reason) {
    if (this.edges[e] === value) return !this.contradiction;
    if (this.edges[e] !== UNKNOWN) {
      if (this.reasons && reason) {
        const r = this.withPremises(e, typeof reason === 'string' ? { rule: reason } : reason);
        this.clash = { kind: 'conflict', edge: e, value, reason: r, premises: [e, ...r.premises] };
      }
      this.contradiction = true;
      return false;
    }
    const g = this.grid;
    // 前提は、この辺が決まる直前の盤面から取る
    const tracked = this.reasons && reason
      ? this.withPremises(e, typeof reason === 'string' ? { rule: reason } : reason)
      : null;
    this.edges[e] = value;
    this.unknownCount--;
    if (this.reasons) {
      this.order[e] = this.seq++;
      if (tracked && !this.reasons[e]) this.reasons[e] = tracked;
    }

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
          this.clash = { kind: 'loop' };
          if (this.reasons) {
            const cycle = [...this.linePath(a, b, e), e];
            const witness = this.loopWitness(cycle);
            this.clash = { kind: 'loop', cycle, witness, premises: [...cycle, ...witnessEdges(witness)] };
          }
          this.contradiction = true;
          return false;
        }
      }
    }
    return this.parityUnion(e, value);
  }

  /* ---------------- R5 内側と外側 ---------------- */

  /** 辺の両側（マスの番号。盤の外側は cellCount）。 */
  edgeSides(e) {
    const cs = this.grid.edgeCells[e];
    return cs.length === 2 ? [cs[0], cs[1]] : [cs[0], this.grid.cellCount];
  }

  /** 組の代表と、代表から見た内外の関係（0 同じ・1 反対）。 */
  pfind(x) {
    const par = this.ppar;
    const rel = this.prel;
    let root = x;
    let p = 0;
    while (par[root] !== root) { p ^= rel[root]; root = par[root]; }
    // 道をちぢめる（関係もたどった分を足しておく）
    let cur = x;
    let acc = p;
    while (par[cur] !== root) {
      const next = par[cur];
      const r = rel[cur];
      par[cur] = root;
      rel[cur] = acc;
      acc ^= r;
      cur = next;
    }
    return [root, p];
  }

  /** あるノード（マスか盤の外）に接する辺。 */
  nodeEdges(node) {
    const g = this.grid;
    if (node < g.cellCount) return [0, 1, 2, 3].map((k) => g.cellEdges[node * 4 + k]);
    g.borderEdges ??= Array.from({ length: g.edgeCount }, (_, e) => e).filter((e) => g.edgeCells[e].length === 1);
    return g.borderEdges;
  }

  /** 決まった辺 e の両側を、同じ側（×）か反対側（線）として結ぶ。食い違えば矛盾。 */
  parityUnion(e, value) {
    const [a, b] = this.edgeSides(e);
    let [ra, pa] = this.pfind(a);
    let [rb, pb] = this.pfind(b);
    const d = value === LINE ? 1 : 0;
    if (ra === rb) {
      if ((pa ^ pb) === d) return true;
      this.clash = { kind: 'parity', edge: e, value };
      if (this.reasons) {
        const path = this.parityPath(a, b, e);
        this.clash.path = path;
        this.clash.premises = [...path, e];
      }
      this.contradiction = true;
      return false;
    }
    // 小さいほうの組のマスから、相手の組のマスへの未確定の辺を探す（合わせると決まる辺）
    if (this.psize[ra] > this.psize[rb]) { [ra, rb] = [rb, ra]; [pa, pb] = [pb, pa]; }
    let m = ra;
    do {
      for (const x of this.nodeEdges(m)) {
        if (this.edges[x] !== UNKNOWN) continue;
        const [u, w] = this.edgeSides(x);
        const other = u === m ? w : u;
        if (this.pfind(other)[0] === rb) this.queueParity.push(x);
      }
      m = this.pnext[m];
    } while (m !== ra);
    this.ppar[ra] = rb;
    this.prel[ra] = pa ^ pb ^ d;
    this.psize[rb] += this.psize[ra];
    const t = this.pnext[ra];
    this.pnext[ra] = this.pnext[rb];
    this.pnext[rb] = t;
    return true;
  }

  /** 確定した辺だけをまたいで、a から b へ行く道（辺の列）。skip の辺は通らない。 */
  parityPath(a, b, skip = -1) {
    const prev = new Map([[a, -1]]);
    const queue = [a];
    for (let q = 0; q < queue.length; q++) {
      const node = queue[q];
      if (node === b) break;
      for (const x of this.nodeEdges(node)) {
        if (x === skip || this.edges[x] === UNKNOWN) continue;
        const [u, w] = this.edgeSides(x);
        const to = u === node ? w : u;
        if (prev.has(to)) continue;
        prev.set(to, x);
        queue.push(to);
      }
    }
    const path = [];
    for (let node = b; node !== a;) {
      const x = prev.get(node);
      if (x === undefined || x < 0) return path;
      path.push(x);
      const [u, w] = this.edgeSides(x);
      node = u === node ? w : u;
    }
    return path.reverse();
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
          if (line > clue || line + unknown < clue) {
            this.clash = { kind: 'cell', index: cell, clue, line, unknown };
            if (this.reasons) {
              this.clash.premises = this.cellEdgesWith(cell, line > clue ? LINE : CROSS, -1);
            }
            this.contradiction = true;
            return false;
          }
          if (unknown > 0 && line === clue) {
            for (let k = 0; k < 4; k++) {
              const e = g.cellEdges[cell * 4 + k];
              if (this.edges[e] === UNKNOWN && !this.setEdge(e, CROSS, { rule: 'clue_full', cell })) return false;
            }
          } else if (unknown > 0 && line + unknown === clue) {
            for (let k = 0; k < 4; k++) {
              const e = g.cellEdges[cell * 4 + k];
              if (this.edges[e] === UNKNOWN && !this.setEdge(e, LINE, { rule: 'clue_rest', cell })) return false;
            }
          }
          continue;
        }
        const v = this.queueVertices.pop();
        const line = this.vertexLine[v];
        const unknown = this.vertexUnknown[v];
        if (line > 2) {
          this.clash = { kind: 'vertex', index: v, line };
          if (this.reasons) this.clash.premises = this.vertexEdgesWith(v, LINE, -1);
          this.contradiction = true;
          return false;
        }
        if (line === 1 && unknown === 0) {
          this.clash = { kind: 'vertex', index: v, line, dead: true };
          if (this.reasons) this.clash.premises = g.vertexEdges[v].slice();
          this.contradiction = true;
          return false;
        }
        if (line === 2 && unknown > 0) {
          for (const e of g.vertexEdges[v]) {
            if (this.edges[e] === UNKNOWN && !this.setEdge(e, CROSS, { rule: 'vertex_two', vertex: v })) return false;
          }
        } else if (line === 1 && unknown === 1) {
          for (const e of g.vertexEdges[v]) {
            if (this.edges[e] === UNKNOWN && !this.setEdge(e, LINE, { rule: 'vertex_pair', vertex: v })) return false;
          }
        } else if (line === 0 && unknown === 1) {
          for (const e of g.vertexEdges[v]) {
            if (this.edges[e] === UNKNOWN && !this.setEdge(e, CROSS, { rule: 'vertex_dead', vertex: v })) return false;
          }
        }
      }
      if (!this.applyParityRule()) return false;
      if (this.queueCells.length || this.queueVertices.length) continue;
      if (!this.applyLoopRule()) return false;
      if (!this.applyCompletionRule()) return false;
      if (!this.queueCells.length && !this.queueVertices.length && !this.queueParity.length) break;
    }
    return !this.contradiction;
  }

  /** R5: 両側の内外の関係が分かった辺を決める。 */
  applyParityRule() {
    while (this.queueParity.length) {
      const e = this.queueParity.pop();
      if (this.edges[e] !== UNKNOWN) continue;
      const [a, b] = this.edgeSides(e);
      const [ra, pa] = this.pfind(a);
      const [rb, pb] = this.pfind(b);
      if (ra !== rb) continue;
      if (!this.setEdge(e, pa ^ pb ? LINE : CROSS, { rule: 'parity', a, b })) return false;
    }
    return true;
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
        let reason = { rule: 'loop_closed' };
        if (this.reasons) {
          const cycle = [...this.linePath(a, b, -1), e];
          reason = { rule: 'loop_closed', cycle, witness: this.loopWitness(cycle) };
        }
        if (!this.setEdge(e, CROSS, reason)) return false;
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
    let reason = { rule: 'loop_done' };
    if (this.reasons) {
      const cycle = [];
      for (let e = 0; e < this.grid.edgeCount; e++) if (this.edges[e] === LINE) cycle.push(e);
      reason = { rule: 'loop_done', cycle };
    }
    for (let e = 0; e < this.grid.edgeCount; e++) {
      if (this.edges[e] === UNKNOWN && !this.setEdge(e, CROSS, reason)) return false;
    }
    return true;
  }

  /**
   * 理由に「何が分かっていたからそう決まったか」（前提の辺）を付ける。
   * 前提は理由の種類ごとに最小限に絞る。ヒントの説明と検算に使う。
   */
  withPremises(e, reason) {
    if (reason.premises) return reason;
    const { rule } = reason;
    let premises = [];
    if (rule === 'clue_full') premises = this.cellEdgesWith(reason.cell, LINE, e);
    else if (rule === 'clue_rest') premises = this.cellEdgesWith(reason.cell, CROSS, e);
    else if (rule === 'vertex_two') premises = this.vertexEdgesWith(reason.vertex, LINE, e);
    else if (rule === 'vertex_pair' || rule === 'vertex_dead') {
      premises = this.grid.vertexEdges[reason.vertex].filter((x) => x !== e && this.edges[x] !== UNKNOWN);
    } else if (rule === 'loop_closed') {
      premises = [...reason.cycle.filter((x) => x !== e), ...witnessEdges(reason.witness)];
    } else if (rule === 'loop_done') premises = reason.cycle;
    else if (rule === 'parity') {
      const [a, b] = this.edgeSides(e);
      const path = reason.path ?? this.parityPath(a, b, e);
      return { ...reason, a, b, path, premises: path };
    }
    return { ...reason, premises };
  }

  cellEdgesWith(cell, value, except) {
    const list = [];
    for (let k = 0; k < 4; k++) {
      const x = this.grid.cellEdges[cell * 4 + k];
      if (x !== except && this.edges[x] === value) list.push(x);
    }
    return list;
  }

  vertexEdgesWith(v, value, except) {
    return this.grid.vertexEdges[v].filter((x) => x !== except && this.edges[x] === value);
  }

  /** 線だけをたどって a から b へ行く道（辺の列）。skip の辺は通らない。 */
  linePath(a, b, skip) {
    const g = this.grid;
    const prev = new Map([[a, -1]]);
    const queue = [a];
    while (queue.length) {
      const v = queue.shift();
      if (v === b) break;
      for (const x of g.vertexEdges[v]) {
        if (x === skip || this.edges[x] !== LINE) continue;
        const to = g.edgeEnds[x * 2] === v ? g.edgeEnds[x * 2 + 1] : g.edgeEnds[x * 2];
        if (prev.has(to)) continue;
        prev.set(to, x);
        queue.push(to);
      }
    }
    const path = [];
    for (let v = b; v !== a;) {
      const x = prev.get(v);
      if (x === undefined || x < 0) return path;
      path.push(x);
      v = g.edgeEnds[x * 2] === v ? g.edgeEnds[x * 2 + 1] : g.edgeEnds[x * 2];
    }
    return path;
  }

  /**
   * 輪 cycle が答えそのものになれない証拠を 1 つ探す。
   * 輪の外にある線（{edge}）か、輪だけでは本数が合わない数字（{cell}）。
   */
  loopWitness(cycle) {
    const g = this.grid;
    const onCycle = new Set(cycle);
    for (let x = 0; x < g.edgeCount; x++) {
      if (this.edges[x] === LINE && !onCycle.has(x)) return { edge: x };
    }
    for (let cell = 0; cell < g.cellCount; cell++) {
      const clue = this.clues[cell];
      if (clue < 0) continue;
      let n = 0;
      for (let k = 0; k < 4; k++) if (onCycle.has(g.cellEdges[cell * 4 + k])) n++;
      if (n !== clue) return { cell, count: n };
    }
    return null;
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
      if (!state.setEdge(e, CROSS, { rule: 'assume_line', clash: tryLine.clash }) || !state.propagate()) return true;
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
      if (!state.setEdge(e, LINE, { rule: 'assume_cross', clash: tryCross.clash }) || !state.propagate()) return true;
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
      if (!state.setEdge(e, CROSS, { rule: 'assume_line', clash: a.clash }) || !state.propagate()) return false;
    } else if (!bOk) {
      if (!state.setEdge(e, LINE, { rule: 'assume_cross', clash: b.clash }) || !state.propagate()) return false;
    }
  }
  return true;
}

/** 輪の証拠のうち、前提として使う辺。 */
function witnessEdges(witness) {
  return witness && witness.edge != null ? [witness.edge] : [];
}

/** 確定済みの辺に隣接する未確定辺 (= 推論が進みやすい場所) を集める。 */
export function frontierEdges(state) {
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
