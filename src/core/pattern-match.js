/**
 * 定石を盤面に当てはめる。
 *
 * 定石は 1 つの向きだけ書いてあるので、回転・反転の 8 通りに変換してから
 * 盤面じゅうを走査する。前提（数字と、すでに引かれた印）がぴったり合った
 * 場所を「当てはまる場所」とし、その結論のうちまだ空白の辺を返す。
 */

import { getGrid, UNKNOWN, LINE, CROSS } from './grid.js';
import { SolveState } from './solver.js';

/**
 * 頂点の座標を変換する 8 通り。
 * 変換後の盤の大きさ（行数・列数が入れ替わるか）も持つ。
 */
const TRANSFORMS = [
  { id: 0, swap: false, map: (r, c, R, C) => [r, c] },                 // そのまま
  { id: 1, swap: true,  map: (r, c, R, C) => [c, R - r] },             // 右に 90 度
  { id: 2, swap: false, map: (r, c, R, C) => [R - r, C - c] },         // 180 度
  { id: 3, swap: true,  map: (r, c, R, C) => [C - c, r] },             // 左に 90 度
  { id: 4, swap: false, map: (r, c, R, C) => [r, C - c] },             // 左右反転
  { id: 5, swap: false, map: (r, c, R, C) => [R - r, c] },             // 上下反転
  { id: 6, swap: true,  map: (r, c, R, C) => [c, r] },                 // 対角で反転
  { id: 7, swap: true,  map: (r, c, R, C) => [C - c, R - r] },         // 逆対角で反転
];

/** 定石を 1 つの向きに変換する。 */
export function transformPattern(pattern, transform) {
  const R = pattern.rows;
  const C = pattern.cols;
  const rows = transform.swap ? C : R;
  const cols = transform.swap ? R : C;
  const vertex = (r, c) => transform.map(r, c, R, C);

  const clues = pattern.clues.map(([r, c, n]) => {
    // マスは左上と右下の頂点で表し、変換後にその最小側を左上とする
    const [ar, ac] = vertex(r, c);
    const [br, bc] = vertex(r + 1, c + 1);
    return [Math.min(ar, br), Math.min(ac, bc), n];
  });

  const mark = ([dir, r, c, kind]) => {
    const [ar, ac] = vertex(r, c);
    const [br, bc] = dir === 'h' ? vertex(r, c + 1) : vertex(r + 1, c);
    return ar === br
      ? ['h', ar, Math.min(ac, bc), kind]
      : ['v', Math.min(ar, br), ac, kind];
  };

  // 角に合わせる定石は、もとの (0,0) のマスがどこへ行ったかを覚えておく
  let anchorCell = null;
  if (pattern.anchor === 'corner') {
    const [ar, ac] = vertex(0, 0);
    const [br, bc] = vertex(1, 1);
    anchorCell = [Math.min(ar, br), Math.min(ac, bc)];
  }

  // 縁に沿わせる定石は、もとの上辺が変換後どの辺になったかを覚えておく
  let borderSide = null;
  if (pattern.anchor === 'border') {
    const [ar, ac] = vertex(0, 0);
    const [br, bc] = vertex(0, C);
    if (ar === 0 && br === 0) borderSide = 'top';
    else if (ar === rows && br === rows) borderSide = 'bottom';
    else if (ac === 0 && bc === 0) borderSide = 'left';
    else borderSide = 'right';
  }

  return {
    ...pattern,
    rows,
    cols,
    clues,
    given: pattern.given.map(mark),
    conclude: pattern.conclude.map(mark),
    transform: transform.id,
    anchorCell,
    borderSide,
  };
}

/** 重複しない向きだけを返す（対称な形は 8 通りに増えない）。 */
export function orientationsOf(pattern) {
  const seen = new Set();
  const list = [];
  for (const transform of TRANSFORMS) {
    const variant = transformPattern(pattern, transform);
    const key = JSON.stringify([
      variant.rows, variant.cols,
      [...variant.clues].sort(cmp), [...variant.given].sort(cmp), [...variant.conclude].sort(cmp),
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(variant);
  }
  return list;
}

const cmp = (a, b) => String(a) < String(b) ? -1 : 1;

const edgeOf = (grid, dir, r, c) => (dir === 'h' ? grid.h(r, c) : grid.v(r, c));
const valueOf = (kind) => (kind === 'line' ? LINE : CROSS);

/**
 * 置ける位置の範囲を求める。
 *
 * 定義の rows/cols は図を見やすくするための枠であって、まわりの余白マスは
 * 推論に使っていない。枠ごと盤に収まることを求めてしまうと、盤の端にある
 * 0 などに当てはまらなくなる。そこで「実際に参照する数字と辺」だけが
 * 盤の中に入る範囲を計算する。
 */
function offsetRange(variant, rows, cols) {
  let minDr = -Infinity;
  let maxDr = Infinity;
  let minDc = -Infinity;
  let maxDc = Infinity;
  const clamp = (lowR, highR, lowC, highC) => {
    minDr = Math.max(minDr, lowR);
    maxDr = Math.min(maxDr, highR);
    minDc = Math.max(minDc, lowC);
    maxDc = Math.min(maxDc, highC);
  };

  for (const [r, c] of variant.clues) clamp(-r, rows - 1 - r, -c, cols - 1 - c);
  for (const [dir, r, c] of [...variant.given, ...variant.conclude]) {
    // h(r,c) は r が 0..rows、c が 0..cols-1。v(r,c) はその逆。
    clamp(-r, (dir === 'h' ? rows : rows - 1) - r, -c, (dir === 'h' ? cols - 1 : cols) - c);
  }
  return { minDr, maxDr, minDc, maxDc };
}

/** その向きを置ける位置を列挙する。 */
function placements(variant, rows, cols) {
  const { minDr, maxDr, minDc, maxDc } = offsetRange(variant, rows, cols);
  if (minDr > maxDr || minDc > maxDc) return [];

  if (variant.anchor === 'corner') {
    // 角合わせ: もとの (0,0) のマスが盤の角に来る置き方だけ
    const [ar, ac] = variant.anchorCell;
    const dr = ar === 0 ? 0 : rows - 1 - ar;
    const dc = ac === 0 ? 0 : cols - 1 - ac;
    if (dr < minDr || dr > maxDr || dc < minDc || dc > maxDc) return [];
    return [[dr, dc]];
  }

  const list = [];
  // 縁合わせ: 盤のその辺にぴったり付けたうえで、辺に沿ってずらす
  const fixedDr = variant.borderSide === 'top' ? 0
    : variant.borderSide === 'bottom' ? rows - variant.rows : null;
  const fixedDc = variant.borderSide === 'left' ? 0
    : variant.borderSide === 'right' ? cols - variant.cols : null;

  for (let dr = minDr; dr <= maxDr; dr++) {
    if (fixedDr !== null && dr !== fixedDr) continue;
    for (let dc = minDc; dc <= maxDc; dc++) {
      if (fixedDc !== null && dc !== fixedDc) continue;
      list.push([dr, dc]);
    }
  }
  return list;
}

/**
 * いまの盤面で、この定石が当てはまる場所を探す。
 * @param {object} grid
 * @param {Int8Array} clues 問題の数字（-1 は空白）
 * @param {Int8Array} state いま盤面に引かれている印
 * @param {object} pattern
 * @returns {{fills:{edge:number,value:number}[], conflicts:number, places:number}}
 */
export function findMatches(grid, clues, state, pattern) {
  if (pattern.match === 'loop') return findLoopMatches(grid, clues, state);

  const fills = new Map();
  let conflicts = 0;
  let places = 0;

  for (const variant of orientationsOf(pattern)) {
    for (const [dr, dc] of placements(variant, grid.rows, grid.cols)) {
      if (!matchesHere(grid, clues, state, variant, dr, dc)) continue;

      const found = [];
      let conflicted = false;
      for (const [dir, r, c, kind] of variant.conclude) {
        const edge = edgeOf(grid, dir, r + dr, c + dc);
        const value = valueOf(kind);
        const current = state[edge];
        if (current === UNKNOWN) found.push({ edge, value });
        else if (current !== value) conflicted = true;
      }
      if (conflicted) conflicts++;
      if (found.length === 0) continue;
      places++;
      for (const fill of found) fills.set(fill.edge, fill);
    }
  }
  return { fills: [...fills.values()], conflicts, places };
}

function matchesHere(grid, clues, state, variant, dr, dc) {
  for (const [r, c, n] of variant.clues) {
    if (clues[(r + dr) * grid.cols + (c + dc)] !== n) return false;
  }
  for (const [dir, r, c, kind] of variant.given) {
    if (state[edgeOf(grid, dir, r + dr, c + dc)] !== valueOf(kind)) return false;
  }
  return true;
}

/**
 * 「輪はひとつだけ」のルールを盤面全体に当てはめる。
 * いま線にすると輪が閉じてしまい、しかもそれで完成にならない辺を × にする。
 */
function findLoopMatches(grid, clues, state) {
  const probe = new SolveState(grid, clues, false);
  for (let e = 0; e < grid.edgeCount; e++) {
    if (state[e] === UNKNOWN) continue;
    if (!probe.setEdge(e, state[e], 'given')) return { fills: [], conflicts: 1, places: 0 };
  }
  const before = probe.edges.slice();
  if (!probe.applyLoopRule()) return { fills: [], conflicts: 1, places: 0 };

  const fills = [];
  for (let e = 0; e < grid.edgeCount; e++) {
    if (before[e] === UNKNOWN && probe.edges[e] === CROSS) fills.push({ edge: e, value: CROSS });
  }
  return { fills, conflicts: 0, places: fills.length };
}

export { getGrid };
