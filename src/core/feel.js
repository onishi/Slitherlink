/**
 * 解き味のうち「考える手」の数。人が解くように、盤面を見ただけで決まる手はまとめて打ち、
 * それが尽きたところで少し先を読む（仮定して矛盾を見る）手を 1 つ打つ、を繰り返し、
 * 先を読む手が何回要ったかを数える。
 * ニコリの 10×10 入門は 2〜19 回あり、このアプリの作問の入門は 0 回だった（作業だけで終わる）。
 */
import { getGrid, UNKNOWN } from './grid.js';
import { collectProofs } from './proof.js';

/**
 * @param {{rows:number, cols:number, clues:ArrayLike<number>, solution:ArrayLike<number>}} puzzle
 * @param {number} [stopAt] これだけ数えたら打ち切る（合格かどうかだけ知りたいとき）
 * @returns {number} 考える手の回数
 */
export function thinkMoves(puzzle, stopAt = Infinity) {
  const grid = getGrid(puzzle.rows, puzzle.cols);
  const board = new Int8Array(grid.edgeCount);
  const solution = Int8Array.from(puzzle.solution);
  let count = 0;
  while (board.includes(UNKNOWN) && count < stopAt) {
    const proofs = collectProofs(grid, puzzle.clues, board, { solution, maxDepth: 0, limit: 1 });
    if (!proofs.length) break;
    if (proofs[0].kind === 'direct') {
      for (const p of proofs) board[p.edge] = p.value;
    } else {
      count++;
      board[proofs[0].edge] = proofs[0].value;
    }
  }
  return count;
}

/**
 * 解き味の手触り。人のように解いたときの様子を数える（thinkMoves と同じ進め方）。
 *   openings   最初に、盤面を見ただけで決まる手の数（マスあたり）。多いほど入りやすい
 *   thinkRate  決まる辺 100 本あたりの、考える手の回数。多いほど休む間がない
 *   thinkMid   考える手が出てくる位置の平均（0 が序盤、1 が終盤）。大きいほど山場が後ろ
 *   quietGap   考える手のない区間のうち、いちばん長いもの（全体に対する割合）。息つける区間
 *   thinkEdges 考える手で決めた辺（どこで考えさせられたか）
 * ニコリ（とことん01）の 24×14 ふつうは、openings 0.2・thinkRate 10・thinkMid 0.58 くらい。
 */
export function feelProfile(puzzle) {
  const grid = getGrid(puzzle.rows, puzzle.cols);
  const board = new Int8Array(grid.edgeCount);
  const solution = Int8Array.from(puzzle.solution);
  const at = [];
  const thinkEdges = [];
  let filled = 0;
  let openings = null;
  while (board.includes(UNKNOWN)) {
    const proofs = collectProofs(grid, puzzle.clues, board, { solution, maxDepth: 0, limit: 1 });
    if (!proofs.length) break;
    if (proofs[0].kind === 'direct') {
      if (openings == null) openings = proofs.length;
      for (const p of proofs) if (board[p.edge] === UNKNOWN) { board[p.edge] = p.value; filled++; }
    } else {
      if (openings == null) openings = 0;
      at.push(filled / grid.edgeCount);
      thinkEdges.push(proofs[0].edge);
      board[proofs[0].edge] = proofs[0].value;
      filled++;
    }
  }
  let gap = 0;
  let prev = 0;
  for (const x of at) { gap = Math.max(gap, x - prev); prev = x; }
  gap = Math.max(gap, filled / grid.edgeCount - prev);
  return {
    openings: (openings ?? 0) / grid.cellCount,
    thinkRate: (100 * at.length) / grid.edgeCount,
    thinkMid: at.length ? at.reduce((a, b) => a + b, 0) / at.length : null,
    quietGap: gap,
    think: at.length,
    thinkEdges,
  };
}

/** 作業だけの手（線を引かずに × を付けるだけの手）。続けて打つほど、作業の続く区間が長い。 */
const WORK_RULES = new Set(['clue_full', 'vertex_dead', 'vertex_two']);

/**
 * 作業の続く区間のいちばん長いもの（手数）。人のように 1 手ずつ解く：いま決まる手のうち、
 * 直前の手にいちばん近いもの（同じ距離なら根拠の少ないもの）を打ち、作業だけの手が何手続いたかを数える。
 * ニコリ（とことん01）の 24×14 は中央値 19 手、ニコリ風 3 版は 29 手だった。
 * 1 手ずつ証明を集めるので重い（24×14 で 1 秒ほど）。作問では最後の候補選びにだけ使う。
 * @param {{rows:number, cols:number, clues:ArrayLike<number>, solution:ArrayLike<number>}} puzzle
 * @param {number} [stopAt] これだけ続いたら打ち切る（合格かどうかだけ知りたいとき）
 * @returns {number}
 */
export function workRun(puzzle, stopAt = Infinity) {
  const grid = getGrid(puzzle.rows, puzzle.cols);
  const board = new Int8Array(grid.edgeCount);
  const solution = Int8Array.from(puzzle.solution);
  const mid = (e) => {
    const i = grid.edgeInfo[e];
    return i.dir === 'h' ? [i.r, i.c + 0.5] : [i.r + 0.5, i.c];
  };
  let last = null;
  let run = 0;
  let longest = 0;
  while (board.includes(UNKNOWN) && longest < stopAt) {
    const proofs = collectProofs(grid, puzzle.clues, board, { solution, limit: 50 });
    if (!proofs.length) break;
    let best = proofs[0];
    let bestScore = Infinity;
    for (const p of proofs) {
      const [r, c] = mid(p.edge);
      const dist = last ? Math.abs(r - last[0]) + Math.abs(c - last[1]) : 0;
      const score = dist * 10 + (p.kind === 'direct' ? (p.step.premises?.length ?? 0) : 100);
      if (score < bestScore) { bestScore = score; best = p; }
    }
    if (best.kind === 'direct' && WORK_RULES.has(best.step?.rule)) longest = Math.max(longest, ++run);
    else run = 0;
    board[best.edge] = best.value;
    last = mid(best.edge);
  }
  return longest;
}
