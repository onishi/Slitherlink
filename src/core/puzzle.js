/**
 * 問題のシリアライズ（問題コード）。URL に載せるので短くする。
 *
 * 形式:  <縦><難易度><本体>（正方形） または <縦>x<横><難易度><本体>
 *   難易度は 1 文字（入門 b・やさしい e・ふつう n・むずかしい h・鬼 x）
 *   本体は、マスごとに「数字があるか」1 ビット＋あれば数字（0〜3）2 ビットを並べ、
 *   6 ビットずつ URL にそのまま使える文字（A-Z a-z 0-9 - _）にしたもの
 * 例: "10hSlQkA…"（10×10・むずかしい）。数字が 4 割なら、1 マスあたり約 1.8 ビットで済む。
 *
 * 以前の形式 "<縦>x<横>:<難易度>:<本体>"（本体は数字をそのまま、空白の連続を a〜z）も読める。
 */

import { getGrid } from './grid.js';
import { solveLogical } from './solver.js';
import { solveWithProofs } from './proof.js';

const DIFF_CODE = { intro: 'b', easy: 'e', normal: 'n', hard: 'h', expert: 'x' };
const CODE_DIFF = { b: 'intro', e: 'easy', n: 'normal', h: 'hard', x: 'expert' };
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function encodePuzzle(puzzle) {
  const d = DIFF_CODE[puzzle.difficulty] ?? 'n';
  // 数字の 4 は 2 ビットに入らない（1×1 の盤でしか出ない）ので、そのときは以前の形式にする
  if (puzzle.clues.some((v) => v > 3)) return encodeLegacy(puzzle, d);
  const bits = [];
  for (const v of puzzle.clues) {
    if (v < 0) bits.push(0);
    else bits.push(1, v >> 1, v & 1);
  }
  let body = '';
  for (let i = 0; i < bits.length; i += 6) {
    let n = 0;
    for (let k = 0; k < 6; k++) n = (n << 1) | (bits[i + k] ?? 0);
    body += B64[n];
  }
  const size = puzzle.rows === puzzle.cols ? `${puzzle.rows}` : `${puzzle.rows}x${puzzle.cols}`;
  return `${size}${d}${body}`;
}

function encodeLegacy(puzzle, d) {
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
  return `${puzzle.rows}x${puzzle.cols}:${d}:${body}`;
}

/** 扱える盤の大きさ（縦横どちらも）。教師データの大きな盤（20×36）も入るように。 */
export const MAX_SIZE = 50;

function checkSize(rows, cols) {
  if (rows < 2 || cols < 2 || rows > MAX_SIZE || cols > MAX_SIZE) throw new Error('盤面サイズが範囲外です');
}

export function decodePuzzle(text) {
  const str = String(text).trim();
  const legacy = /^(\d+)x(\d+):([benhx]):([0-4a-z]*)$/.exec(str);
  if (legacy) return decodeLegacy(legacy);
  const m = /^(\d+)(?:x(\d+))?([benhx])([A-Za-z0-9_-]*)$/.exec(str);
  if (!m) throw new Error('問題コードの形式が正しくありません');
  const rows = Number(m[1]);
  const cols = m[2] ? Number(m[2]) : rows;
  checkSize(rows, cols);
  const body = m[4];
  let pos = 0;
  const bit = () => {
    const ch = body[Math.floor(pos / 6)];
    if (ch === undefined) throw new Error('問題コードの長さが合いません');
    const n = B64.indexOf(ch);
    const b = (n >> (5 - (pos % 6))) & 1;
    pos++;
    return b;
  };
  const clues = new Int8Array(rows * cols).fill(-1);
  for (let i = 0; i < clues.length; i++) {
    if (bit()) clues[i] = (bit() << 1) | bit();
  }
  if (Math.ceil(pos / 6) !== body.length) throw new Error('問題コードが長すぎます');
  return { rows, cols, difficulty: CODE_DIFF[m[3]], clues };
}

function decodeLegacy(m) {
  const rows = Number(m[1]);
  const cols = Number(m[2]);
  checkSize(rows, cols);
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

/** 2 つの問題コードが同じ問題か（新旧どちらの形式でも比べられる）。 */
export function samePuzzle(a, b) {
  try {
    return encodePuzzle(decodePuzzle(a)) === encodePuzzle(decodePuzzle(b));
  } catch {
    return false;
  }
}

/**
 * 問題コードから解を復元する。
 * 検算に通る証明つきの手だけで最後まで解けなければ null（当てずっぽうが要る問題は受け付けない）。
 * 証明だけで決まった答えなので、解は自動的に一意になる。
 */
export function solutionFor(puzzle) {
  const grid = getGrid(puzzle.rows, puzzle.cols);
  // ソルバで答えの見当をつけ、証明を探す範囲を絞る（見当は証明の中身には使わない）
  let guess;
  for (const depth of [0, 1, 2]) {
    const res = solveLogical(grid, puzzle.clues, { maxDepth: depth });
    if (res.status === 'contradiction') return null;
    if (res.status === 'solved') { guess = res.state.toEdgeArray(); break; }
  }
  const proved = solveWithProofs(grid, puzzle.clues, { maxDepth: 1, solution: guess });
  return proved.solved ? proved.edges : null;
}

/**
 * 持ち込まれた問題（写真から読み取ったものなど）を確かめる。
 * - 'ok'           : 証明つきの手だけで最後まで解ける（＝答えが 1 つに決まる）
 * - 'contradiction': 数字どうしが矛盾していて、答えが無い
 * - 'stuck'        : 論理だけでは解き切れない（答えが複数あるか、当てずっぽうが要る）
 * むずかしさ（解き味）は difficulty-report.js の rateImported で付ける。
 * @returns {{status:string, solution?:Int8Array, clueCount:number}}
 */
export function checkPuzzle(puzzle) {
  const grid = getGrid(puzzle.rows, puzzle.cols);
  let clueCount = 0;
  for (const c of puzzle.clues) if (c >= 0) clueCount++;
  for (const depth of [0, 1, 2]) {
    const res = solveLogical(grid, puzzle.clues, { maxDepth: depth });
    if (res.status === 'contradiction') return { status: 'contradiction', clueCount };
    if (res.status === 'solved') break;
  }
  const solution = solutionFor(puzzle);
  if (!solution) return { status: 'stuck', clueCount };
  return { status: 'ok', solution, clueCount };
}
