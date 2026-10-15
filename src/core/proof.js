/**
 * 「なぜその辺が決まるのか」を、いまの盤面から一歩ずつたどれる証明として組み立てる。
 *
 * 証明は 2 種類だけ:
 *   direct        : 盤面に見えている印だけで、基本ルール 1 つが直接当てはまる
 *   contradiction : 逆を仮定すると、基本ルールを順に当てはめるだけで矛盾に行き着く
 *
 * 矛盾までの各手 (step) は、次のどれか 1 つで決まる:
 *   clue_full / clue_rest         数字の本数
 *   vertex_two / vertex_pair / vertex_dead  交点の線は 0 本か 2 本
 *   loop_closed / loop_done       輪はひとつだけ
 *   parity                        輪の内側と外側（線をまたぐと入れ替わり、× をまたぐと同じまま）
 *   case                          さらに仮定を 1 つ置くと矛盾する（入れ子の証明つき）
 *
 * どの手にも「何が分かっていたからそう決まったか」（premises）が付いていて、
 * checkProof がそれだけを見て検算する。ヒントは検算に通った証明しか出さない。
 */

import { UNKNOWN, LINE, CROSS } from './grid.js';
import { SolveState, frontierEdges, solveLogical } from './solver.js';

const opposite = (value) => (value === LINE ? CROSS : LINE);

/** 盤面の印だけを置いた状態（推論はまだ何もしていない）。矛盾していれば null。 */
export function boardState(grid, clues, board) {
  const st = new SolveState(grid, clues, true);
  for (let e = 0; e < grid.edgeCount; e++) {
    const value = board[e];
    if (value !== LINE && value !== CROSS) continue;
    if (!st.setEdge(e, value, 'given')) return null;
  }
  return st;
}

/* ---------------- 直接決まる手 ---------------- */

/**
 * 盤面に見えている印だけで、基本ルールが 1 つ直接当てはまるか。
 * 当てはまれば {kind:'direct', edge, value, step} を返す。
 */
export function directProof(grid, clues, base, edge) {
  if (base.edges[edge] !== UNKNOWN) return null;
  const make = (value, reason) => {
    const step = { edge, value, ...base.withPremises(edge, reason) };
    return { kind: 'direct', edge, value, step };
  };

  for (const cell of grid.edgeCells[edge]) {
    const clue = clues[cell];
    if (clue < 0) continue;
    const line = base.cellLine[cell];
    const unknown = base.cellUnknown[cell];
    if (line === clue) return make(CROSS, { rule: 'clue_full', cell });
    if (line + unknown === clue) return make(LINE, { rule: 'clue_rest', cell });
  }
  for (let k = 0; k < 2; k++) {
    const v = grid.edgeEnds[edge * 2 + k];
    const line = base.vertexLine[v];
    const unknown = base.vertexUnknown[v];
    if (line === 2) return make(CROSS, { rule: 'vertex_two', vertex: v });
    if (line === 1 && unknown === 1) return make(LINE, { rule: 'vertex_pair', vertex: v });
    if (line === 0 && unknown === 1) return make(CROSS, { rule: 'vertex_dead', vertex: v });
  }

  // 内側と外側：両側のマスの関係が、確定した辺をたどって分かっている
  {
    const [a, b] = base.edgeSides(edge);
    const [ra, pa] = base.pfind(a);
    const [rb, pb] = base.pfind(b);
    if (ra === rb) return make(pa ^ pb ? LINE : CROSS, { rule: 'parity' });
  }

  if (base.lineCount > 0) {
    if (base.openEnds === 0 && base.unsatisfied === 0) {
      const cycle = [];
      for (let e = 0; e < grid.edgeCount; e++) if (base.edges[e] === LINE) cycle.push(e);
      return make(CROSS, { rule: 'loop_done', cycle });
    }
    const a = grid.edgeEnds[edge * 2];
    const b = grid.edgeEnds[edge * 2 + 1];
    if (base.dsu.find(a) === base.dsu.find(b)) {
      const cycle = [...base.linePath(a, b, -1), edge];
      const witness = base.loopWitness(cycle);
      if (witness) return make(CROSS, { rule: 'loop_closed', cycle, witness });
    }
  }
  return null;
}

/* ---------------- 背理法 ---------------- */

/**
 * base の上で「edge = assumed」と仮定し、矛盾を導けたらその証明を返す。
 * depth は途中で置いてよい追加の仮定の深さ（0 なら基本ルールの連鎖だけ）。
 */
export function refute(base, edge, assumed, depth, budget = { nodes: 4000 }) {
  if (base.edges[edge] !== UNKNOWN || budget.nodes <= 0) return null;
  budget.nodes--;
  const st = base.clone();
  const start = st.seq;
  if (!st.setEdge(edge, assumed, { rule: 'assume' })) return finish(st, start, edge, assumed);
  if (!st.propagate()) return finish(st, start, edge, assumed);
  if (depth === 0) return null;

  // 追加の仮定を 1 つずつ試し、矛盾した側の逆を確定させながら進む
  for (;;) {
    let progressed = false;
    for (const e of frontierEdges(st)) {
      if (st.edges[e] !== UNKNOWN) continue;
      for (const value of [LINE, CROSS]) {
        if (budget.nodes <= 0) return null;
        const sub = refute(st, e, value, depth - 1, budget);
        if (!sub) continue;
        const reason = { rule: 'case', sub, premises: sub.uses };
        if (!st.setEdge(e, opposite(value), reason) || !st.propagate()) {
          return finish(st, start, edge, assumed);
        }
        progressed = true;
        break;
      }
    }
    if (!progressed) return null;
  }
}

/** 矛盾した状態から、矛盾に本当に必要だった手だけを逆にたどって並べる。 */
function finish(st, start, edge, assumed) {
  const clash = st.clash;
  if (!clash || !clash.premises) return null;
  const need = new Set();
  const uses = new Set();
  const seen = new Set();
  const stack = [...clash.premises];
  if (clash.kind === 'conflict') stack.push(...clash.reason.premises);
  while (stack.length) {
    const e = stack.pop();
    if (seen.has(e)) continue;
    seen.add(e);
    const order = st.order[e];
    if (order < start) { uses.add(e); continue; }   // 仮定より前から分かっていた
    if (order === start) continue;                  // 仮定そのもの
    need.add(e);
    stack.push(...st.reasons[e].premises);
  }
  const steps = [...need]
    .sort((a, b) => st.order[a] - st.order[b])
    .map((e) => ({ edge: e, value: st.edges[e], ...st.reasons[e] }));
  return {
    kind: 'contradiction',
    edge,
    value: opposite(assumed),
    assume: assumed,
    steps,
    clash: { ...clash },
    uses: [...uses],
  };
}

/** 証明の手数（入れ子の仮定の中身も数える）。短いほど分かりやすい。 */
export function proofSize(proof) {
  if (proof.kind === 'direct') return 0;
  let n = proof.steps.length + 1;
  for (const s of proof.steps) if (s.rule === 'case') n += proofSize(s.sub) + 1;
  return n;
}

/**
 * 辺 edge が value に決まることの証明を探す。直接 → 仮定 1 つ → 仮定の中でさらに仮定、の順。
 */
export function proveEdge(grid, clues, base, edge, value, maxDepth = 1) {
  const direct = directProof(grid, clues, base, edge);
  if (direct && direct.value === value) return direct;
  for (let depth = 0; depth <= maxDepth; depth++) {
    const proof = refute(base, edge, opposite(value), depth);
    if (proof) return proof;
  }
  return null;
}

/* ---------------- 検算 ---------------- */

/**
 * 証明を、盤面の印と各手の前提だけを使って一から確かめる。
 * ソルバの内部状態には頼らない（作った側と確かめる側を分ける）。
 */
export function checkProof(grid, clues, board, proof) {
  if (!proof || board[proof.edge] !== UNKNOWN) return false;
  const s = Int8Array.from(board);
  if (proof.kind === 'direct') {
    return proof.step.edge === proof.edge && proof.step.value === proof.value && checkStep(grid, clues, s, proof.step);
  }
  if (proof.kind !== 'contradiction') return false;
  for (const e of proof.uses) if (board[e] === UNKNOWN) return false;
  return checkRefutation(grid, clues, s, proof);
}

function checkRefutation(grid, clues, outer, proof) {
  if (outer[proof.edge] !== UNKNOWN || proof.assume !== opposite(proof.value)) return false;
  const s = Int8Array.from(outer);
  s[proof.edge] = proof.assume;
  for (const step of proof.steps) {
    if (s[step.edge] !== UNKNOWN) return false;
    if (!checkStep(grid, clues, s, step)) return false;
    s[step.edge] = step.value;
  }
  return checkClash(grid, clues, s, proof.clash);
}

/** 前提の辺だけを見て、その手が基本ルールで決まるかを確かめる。 */
function checkStep(grid, clues, s, step) {
  const premises = new Set(step.premises);
  for (const e of premises) if (s[e] === UNKNOWN) return false;
  const known = (e) => (premises.has(e) ? s[e] : UNKNOWN);
  const { edge, value, rule } = step;

  if (rule === 'clue_full' || rule === 'clue_rest') {
    const cell = step.cell;
    const clue = clues[cell];
    if (clue < 0 || !grid.edgeCells[edge].includes(cell)) return false;
    const sides = cellSides(grid, cell);
    if (rule === 'clue_full') return value === CROSS && sides.filter((e) => known(e) === LINE).length === clue;
    return value === LINE && sides.filter((e) => known(e) === CROSS).length === 4 - clue;
  }
  if (rule === 'vertex_two' || rule === 'vertex_pair' || rule === 'vertex_dead') {
    const v = step.vertex;
    const edges = grid.vertexEdges[v];
    if (!edges.includes(edge)) return false;
    const others = edges.filter((e) => e !== edge);
    const lines = others.filter((e) => known(e) === LINE).length;
    const crosses = others.filter((e) => known(e) === CROSS).length;
    if (rule === 'vertex_two') return value === CROSS && lines === 2;
    if (rule === 'vertex_pair') return value === LINE && lines === 1 && crosses === others.length - 1;
    return value === CROSS && crosses === others.length;
  }
  if (rule === 'loop_closed') {
    if (value !== CROSS || !step.cycle.includes(edge)) return false;
    const rest = step.cycle.filter((e) => e !== edge);
    if (!rest.every((e) => known(e) === LINE)) return false;
    return isCycle(grid, step.cycle) && witnessHolds(grid, clues, known, step.cycle, step.witness);
  }
  if (rule === 'loop_done') {
    if (value !== CROSS || step.cycle.includes(edge)) return false;
    if (!step.cycle.every((e) => known(e) === LINE) || !isCycle(grid, step.cycle)) return false;
    const on = new Set(step.cycle);
    for (let cell = 0; cell < grid.cellCount; cell++) {
      if (clues[cell] < 0) continue;
      if (cellSides(grid, cell).filter((e) => on.has(e)).length !== clues[cell]) return false;
    }
    return true;
  }
  if (rule === 'parity') {
    const p = pathParity(grid, step.path, known, edge);
    return p !== null && value === (p ? LINE : CROSS);
  }
  if (rule === 'case') {
    const sub = step.sub;
    if (!sub || sub.kind !== 'contradiction' || sub.edge !== edge || sub.value !== value) return false;
    if (!sub.uses.every((e) => premises.has(e))) return false;
    return checkRefutation(grid, clues, s, sub);
  }
  return false;
}

function checkClash(grid, clues, s, clash) {
  if (!clash || !clash.premises) return false;
  const premises = new Set(clash.premises);
  for (const e of premises) if (s[e] === UNKNOWN) return false;
  const known = (e) => (premises.has(e) ? s[e] : UNKNOWN);

  if (clash.kind === 'cell') {
    const clue = clues[clash.index];
    if (clue < 0) return false;
    const sides = cellSides(grid, clash.index);
    return sides.filter((e) => known(e) === LINE).length > clue
      || sides.filter((e) => known(e) === CROSS).length > 4 - clue;
  }
  if (clash.kind === 'vertex') {
    const edges = grid.vertexEdges[clash.index];
    const lines = edges.filter((e) => known(e) === LINE).length;
    const crosses = edges.filter((e) => known(e) === CROSS).length;
    return lines > 2 || (lines === 1 && crosses === edges.length - 1);
  }
  if (clash.kind === 'loop') {
    if (!clash.cycle.every((e) => known(e) === LINE)) return false;
    return isCycle(grid, clash.cycle) && witnessHolds(grid, clues, known, clash.cycle, clash.witness);
  }
  if (clash.kind === 'parity') {
    // 確定した辺をたどった内外の関係と、その辺の印が食い違う
    const p = pathParity(grid, clash.path, known, clash.edge);
    const v = known(clash.edge);
    return p !== null && v !== UNKNOWN && (v === LINE ? 1 : 0) !== p;
  }
  if (clash.kind === 'conflict') {
    // 同じ辺が、すでに付いている印と逆の値に決まってしまう
    if (s[clash.edge] !== opposite(clash.value)) return false;
    const t = Int8Array.from(s);
    t[clash.edge] = UNKNOWN;
    return checkStep(grid, clues, t, { edge: clash.edge, value: clash.value, ...clash.reason });
  }
  return false;
}

/**
 * 辺 edge の片側から、確定した辺 path を順にまたいで反対側まで行けるか。行けたら、
 * またいだ線の本数の偶奇（1 なら両側は内外が反対）を返す。行けなければ null。
 */
function pathParity(grid, path, known, edge) {
  if (!Array.isArray(path)) return null;
  const sides = (e) => {
    const cs = grid.edgeCells[e];
    return cs.length === 2 ? [cs[0], cs[1]] : [cs[0], grid.cellCount];
  };
  const [a, b] = sides(edge);
  let node = a;
  let p = 0;
  for (const e of path) {
    if (e === edge) return null;
    const v = known(e);
    if (v === UNKNOWN) return null;
    const [u, w] = sides(e);
    if (u === node) node = w;
    else if (w === node) node = u;
    else return null;
    if (v === LINE) p ^= 1;
  }
  return node === b ? p : null;
}

function cellSides(grid, cell) {
  return [0, 1, 2, 3].map((k) => grid.cellEdges[cell * 4 + k]);
}

/** 辺の集まりが、ちょうど 1 つの輪になっているか。 */
function isCycle(grid, edges) {
  if (edges.length < 4) return false;
  const set = new Set(edges);
  if (set.size !== edges.length) return false;
  const degree = new Map();
  for (const e of edges) {
    for (let k = 0; k < 2; k++) {
      const v = grid.edgeEnds[e * 2 + k];
      degree.set(v, (degree.get(v) || 0) + 1);
    }
  }
  for (const d of degree.values()) if (d !== 2) return false;
  // つながっているか
  const start = grid.edgeEnds[edges[0] * 2];
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const v = stack.pop();
    for (const e of grid.vertexEdges[v]) {
      if (!set.has(e)) continue;
      const to = grid.edgeEnds[e * 2] === v ? grid.edgeEnds[e * 2 + 1] : grid.edgeEnds[e * 2];
      if (!seen.has(to)) { seen.add(to); stack.push(to); }
    }
  }
  return seen.size === degree.size;
}

/**
 * 輪 cycle が答えそのものになれない証拠が本当に成り立つか。
 * 輪はひとつだけなので、cycle ができたら答えは cycle そのもの。
 * その外に線があるか、cycle だけでは本数が合わない数字があれば矛盾。
 */
function witnessHolds(grid, clues, known, cycle, witness) {
  if (!witness) return false;
  const on = new Set(cycle);
  if (witness.edge != null) return known(witness.edge) === LINE && !on.has(witness.edge);
  if (witness.cell != null) {
    const clue = clues[witness.cell];
    return clue >= 0 && cellSides(grid, witness.cell).filter((e) => on.has(e)).length !== clue;
  }
  return false;
}

/* ---------------- 盤面全体で次の一手を探す ---------------- */

/**
 * いまの盤面から、検算に通る証明つきで決まる手を集める。
 * いちばん浅い段（直接 → 仮定 1 つ → 仮定を重ねる）で見つかったものだけを返す。
 * どの証明も同じ盤面だけを前提にしているので、まとめて置いても正しさは崩れない。
 * @param {object} [opts]
 * @param {Int8Array} [opts.solution] 正解。分かっていれば探索を半分にできる
 * @param {number} [opts.maxDepth=1] 仮定の中でさらに置いてよい仮定の深さ
 * @param {number} [opts.limit=4] 仮定を重ねる段で、いくつ見つかったら打ち切るか
 * @returns {object[]} 証明の列。決まる手が無ければ空。
 */
export function collectProofs(grid, clues, board, opts = {}) {
  const base = boardState(grid, clues, board);
  if (!base) return [];
  const maxDepth = opts.maxDepth ?? 1;
  const limit = opts.limit ?? 4;

  // 1) 盤面を見ただけで決まる手
  const direct = [];
  for (let e = 0; e < grid.edgeCount; e++) {
    const proof = directProof(grid, clues, base, e);
    if (proof && checkProof(grid, clues, board, proof)) direct.push(proof);
  }
  if (direct.length) return direct;

  // 2) 背理法。正解が分かっていれば、その逆だけを仮定すれば足りる
  //    （正しい値を否定する証明は作れないので、正解を使っても結論は曲がらない）
  const unknown = [];
  for (let e = 0; e < grid.edgeCount; e++) if (board[e] === UNKNOWN) unknown.push(e);
  const assumptions = (e) => (opts.solution ? [opposite(opts.solution[e])] : [LINE, CROSS]);

  for (let depth = 0; depth <= maxDepth; depth++) {
    const found = [];
    for (const e of unknown) {
      for (const assumed of assumptions(e)) {
        const proof = refute(base, e, assumed, depth);
        if (proof && checkProof(grid, clues, board, proof)) found.push(proof);
      }
      // 深い証明は探すのが重いので、いくつか見つかったら打ち切る
      if (depth > 0 && found.length >= limit) break;
    }
    if (found.length) return found;
  }
  return [];
}

/**
 * いまの盤面から、検算に通る証明つきで決まる手を 1 つ選ぶ。
 * 直接決まる手を優先し、なければ背理法の手数が少ないものを選ぶ。
 * @param {object} [opts] collectProofs と同じ。加えて
 * @param {(proof:object)=>number} [opts.rank] 直接決まる手どうしの優先度（小さいほど先）
 * @returns {object|null}
 */
export function findProof(grid, clues, board, opts = {}) {
  const proofs = collectProofs(grid, clues, board, opts);
  if (!proofs.length) return null;
  const score = (p) => (p.kind === 'direct' ? (opts.rank ? opts.rank(p) : 0) : proofSize(p));
  return proofs.reduce((best, p) => (score(p) < score(best) ? p : best));
}

/**
 * 空の盤面から、検算に通る証明だけを積み重ねて最後まで解けるかを確かめる。
 * 「論理だけで解ける」ことの確認に使う。
 * @returns {{solved:boolean, rounds:number, edges:Int8Array}}
 */
export function solveWithProofs(grid, clues, opts = {}) {
  const board = opts.initial ? Int8Array.from(opts.initial) : new Int8Array(grid.edgeCount);
  let rounds = 0;
  while (board.includes(UNKNOWN)) {
    const proofs = collectProofs(grid, clues, board, { limit: 8, ...opts });
    if (!proofs.length) break;
    for (const proof of proofs) board[proof.edge] = proof.value;
    rounds++;
  }
  const final = solveLogical(grid, clues, { maxDepth: 0, initial: board });
  return { solved: final.status === 'solved' && !board.includes(UNKNOWN), rounds, edges: board };
}
