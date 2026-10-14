/**
 * いまの問題の「解き味」を調べる。空の盤から、人が解くのに近い順で解き進め、
 * どの段階の考え方がどれだけ要ったかを数える。
 *
 * 1 段目　ふつうの定石（数字の本数・角の数字・3 と 3 など、形を見れば決まるもの）
 * 2 段目　基本ルールの組み合わせ（定石にはないが、盤面を見ただけで決まるもの）
 * 3 段目　読みの定石（数字のまわりをまとめて考える・近道で輪を閉じない など、局所的に場合分けするもの）
 * 4 段目　仮定 1 段（「ここに線を引いたら…」と 1 か所仮定し、矛盾を見る）
 * 5 段目　仮定 2 段（仮定の中でさらに仮定する）
 * 浅い段で進める限り深い段は使わない。行き詰まったときだけ 1 つ深くする。
 */
import { getGrid, UNKNOWN } from './grid.js';
import { PATTERNS, isSearchPattern } from './patterns.js';
import { findMatches } from './pattern-match.js';
import { collectProofs, proofSize } from './proof.js';
import { solutionFor, checkPuzzle } from './puzzle.js';

/** 証明の中で、仮定が何段重なっているか（仮定 1 つなら 1）。 */
function assumeDepth(proof) {
  if (proof.kind !== 'contradiction') return 0;
  let inner = 0;
  for (const step of proof.steps) if (step.rule === 'case') inner = Math.max(inner, assumeDepth(step.sub));
  return 1 + inner;
}

/**
 * @param {{rows:number, cols:number, clues:Int8Array, solution?:Int8Array}} puzzle
 * @returns {object} 段ごとに決まった辺の数・行き詰まり・よく使った定石など
 */
export function difficultyReport(puzzle) {
  const grid = getGrid(puzzle.rows, puzzle.cols);
  const { clues } = puzzle;
  const solution = puzzle.solution ?? solutionFor(puzzle);
  const state = new Int8Array(grid.edgeCount);
  const plain = PATTERNS.filter((p) => !isSearchPattern(p));
  const search = PATTERNS.filter((p) => isSearchPattern(p));
  const decided = { plain: 0, search: 0, rule: 0, assume1: 0, assume2: 0 };
  const used = new Map(); // 定石 id → { title, edges }
  const stalls = []; // 仮定が要ったところ：{ kind:'assume', depth, edges, steps, progress }
  let firstStall = null; // 仮定なしでどこまで決まったか（最初に仮定が要った時点）

  const applyPatterns = (list, key) => {
    let any = false;
    for (const pattern of list) {
      const { fills } = findMatches(grid, clues, state, pattern);
      let n = 0;
      for (const { edge, value } of fills) {
        if (state[edge] !== UNKNOWN) continue;
        state[edge] = value;
        n++;
      }
      if (!n) continue;
      any = true;
      decided[key] += n;
      const entry = used.get(pattern.id) ?? { id: pattern.id, title: pattern.title, edges: 0, search: key === 'search' };
      entry.edges += n;
      used.set(pattern.id, entry);
    }
    return any;
  };

  const unknownCount = () => state.reduce((n, v) => n + (v === UNKNOWN ? 1 : 0), 0);

  for (let guard = 0; guard < grid.edgeCount * 4 && unknownCount() > 0; guard++) {
    if (applyPatterns(plain, 'plain')) continue;
    // 定石には無いが、盤面だけで決まる手（基本ルールの組み合わせ）
    const direct = collectProofs(grid, clues, state, { solution, maxDepth: -1 });
    if (direct.length) {
      let n = 0;
      for (const proof of direct) if (state[proof.edge] === UNKNOWN) { state[proof.edge] = proof.value; n++; }
      decided.rule += n;
      continue;
    }
    if (applyPatterns(search, 'search')) continue;
    if (firstStall === null) firstStall = grid.edgeCount - unknownCount();
    // 定石でも基本ルールでも進めない：仮定（浅い順）
    const proofs = collectProofs(grid, clues, state, { solution, maxDepth: 1, limit: 4 });
    if (!proofs.length) break;
    const depth = Math.min(...proofs.map(assumeDepth));
    const progress = (grid.edgeCount - unknownCount()) / grid.edgeCount; // 仮定が要った時点
    let n = 0;
    for (const proof of proofs) {
      if (assumeDepth(proof) !== depth || state[proof.edge] !== UNKNOWN) continue;
      state[proof.edge] = proof.value;
      n++;
    }
    if (depth === 0) { decided.rule += n; continue; } // 念のため（上で拾うはず）
    const key = depth === 1 ? 'assume1' : 'assume2';
    decided[key] += n;
    stalls.push({
      kind: 'assume',
      depth,
      edges: n,
      steps: Math.min(...proofs.filter((p) => assumeDepth(p) === depth).map(proofSize)),
      progress,
    });
  }

  const total = grid.edgeCount;
  const assumes = stalls.filter((s) => s.kind === 'assume');
  return {
    total,
    solved: unknownCount() === 0,
    decided,
    // 最初に仮定が要るまでに決まった割合（要らなければ 1）
    beforeAssume: (firstStall ?? total) / total,
    stalls,
    assumeCount: assumes.length,
    maxDepth: assumes.reduce((m, s) => Math.max(m, s.depth), 0),
    deepCount: assumes.filter((s) => s.depth >= 2).length,
    longest: assumes.reduce((m, s) => Math.max(m, s.steps), 0),
    usedPatterns: [...used.values()].sort((a, b) => b.edges - a.edges),
  };
}

/** 解き味の段（やさしい順）。難易度は「どの段まで要るか」で決める。 */
export const LEVELS = ['intro', 'easy', 'normal', 'hard', 'expert'];

/**
 * 分析の結果から難易度を決める。
 * intro 定石だけ ／ easy ＋基本ルールの組み合わせ ／ normal ＋読みの定石 ／ hard ＋仮定 1 段 ／ expert ＋仮定 2 段
 */
export function levelOf(report) {
  if (report.deepCount) return 'expert';
  if (report.assumeCount) return 'hard';
  if (report.decided.search) return 'normal';
  if (report.decided.rule) return 'easy';
  return 'intro';
}

/**
 * 持ち込まれた問題（写真から読み取ったものなど）を確かめ、解けるなら解き味から難易度も付ける。
 * @returns {{status:string, solution?:Int8Array, difficulty?:string, clueCount:number}}
 */
export function rateImported(puzzle) {
  const result = checkPuzzle(puzzle);
  if (result.status !== 'ok') return result;
  const report = difficultyReport({ ...puzzle, solution: result.solution });
  return { ...result, difficulty: levelOf(report) };
}
