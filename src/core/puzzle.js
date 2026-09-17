/**
 * 問題のシリアライズ。
 * 形式:  <rows>x<cols>:<difficulty>:<body>
 *   body は数字 0〜4 をそのまま、空白マスの連続を a(=1個) 〜 z(=26個) で表す。
 * 例: "5x5:n:2b13a0..."
 */

import { getGrid } from './grid.js';
import { solveLogical } from './solver.js';

const DIFF_CODE = { easy: 'e', normal: 'n', hard: 'h' };
const CODE_DIFF = { e: 'easy', n: 'normal', h: 'hard' };

export function encodePuzzle(puzzle) {
  let body = '';
  let blanks = 0;
  const flush = () => {
    while (blanks > 0) {
      const n = Math.min(blanks, 26);
      body += String.fromCharCode(96 + n);
      blanks -= n;
    }
  };
  for (let i = 0; i < puzzle.clues.length; i++) {
    if (puzzle.clues[i] < 0) blanks++;
    else { flush(); body += String(puzzle.clues[i]); }
  }
  flush();
  const code = DIFF_CODE[puzzle.difficulty] ?? 'n';
  return `${puzzle.rows}x${puzzle.cols}:${code}:${body}`;
}

export function decodePuzzle(text) {
  const m = /^(\d+)x(\d+):([enh]):([0-4a-z]*)$/.exec(String(text).trim());
  if (!m) throw new Error('問題コードの形式が正しくありません');
  const rows = Number(m[1]);
  const cols = Number(m[2]);
  if (rows < 2 || cols < 2 || rows > 30 || cols > 30) throw new Error('盤面サイズが範囲外です');
  const clues = new Int8Array(rows * cols).fill(-1);
  let i = 0;
  for (const ch of m[4]) {
    if (ch >= '0' && ch <= '4') {
      if (i >= clues.length) throw new Error('問題コードが長すぎます');
      clues[i++] = ch.charCodeAt(0) - 48;
    } else {
      i += ch.charCodeAt(0) - 96;
    }
  }
  if (i !== clues.length) throw new Error('問題コードの長さが合いません');
  return { rows, cols, difficulty: CODE_DIFF[m[3]], clues };
}

/**
 * 問題コードから解を復元する。解が一意に定まらなければ null。
 */
export function solutionFor(puzzle) {
  const grid = getGrid(puzzle.rows, puzzle.cols);
  for (const depth of [0, 1, 2]) {
    const res = solveLogical(grid, puzzle.clues, { maxDepth: depth });
    if (res.status === 'solved') return res.state.toEdgeArray();
    if (res.status === 'contradiction') return null;
  }
  return null;
}
