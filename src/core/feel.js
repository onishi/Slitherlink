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
