/**
 * 遊んでいる最中の判定まわり。UI から切り離してテストできるようにしている。
 */

import { UNKNOWN, LINE, CROSS } from './grid.js';
import { solveLogical, RULE_LABELS } from './solver.js';

/**
 * 盤面の今の状態を調べる。
 * @returns {{satisfied:number, total:number, badCells:number[], badVertices:number[],
 *            solved:boolean, closedButWrong:boolean}}
 */
export function analyze(grid, clues, state) {
  const badCells = [];
  const badVertices = [];
  let satisfied = 0;
  let total = 0;
  let cluesOk = true;

  for (let cell = 0; cell < grid.cellCount; cell++) {
    const clue = clues[cell];
    if (clue < 0) continue;
    total++;
    let lines = 0, unknown = 0;
    for (let k = 0; k < 4; k++) {
      const v = state[grid.cellEdges[cell * 4 + k]];
      if (v === LINE) lines++;
      else if (v === UNKNOWN) unknown++;
    }
    if (lines === clue) satisfied++;
    else cluesOk = false;
    if (lines > clue || lines + unknown < clue) badCells.push(cell);
  }

  let lineCount = 0;
  let degreeOk = true;
  for (let v = 0; v < grid.vertexCount; v++) {
    let lines = 0;
    for (const e of grid.vertexEdges[v]) if (state[e] === LINE) lines++;
    if (lines > 2) { badVertices.push(v); degreeOk = false; }
    else if (lines === 1) degreeOk = false;
  }
  for (let e = 0; e < grid.edgeCount; e++) if (state[e] === LINE) lineCount++;

  const closed = lineCount > 0 && degreeOk && isOneComponent(grid, state, lineCount);
  return {
    satisfied,
    total,
    badCells,
    badVertices,
    solved: closed && cluesOk,
    closedButWrong: closed && !cluesOk,
  };
}

function isOneComponent(grid, state, lineCount) {
  let start = -1;
  for (let e = 0; e < grid.edgeCount; e++) if (state[e] === LINE) { start = e; break; }
  if (start < 0) return false;
  const seen = new Uint8Array(grid.edgeCount);
  const stack = [start];
  seen[start] = 1;
  let visited = 0;
  while (stack.length) {
    const e = stack.pop();
    visited++;
    for (let k = 0; k < 2; k++) {
      for (const ne of grid.vertexEdges[grid.edgeEnds[e * 2 + k]]) {
        if (state[ne] === LINE && !seen[ne]) { seen[ne] = 1; stack.push(ne); }
      }
    }
  }
  return visited === lineCount;
}

/**
 * 線を引いた結果として自動的に × を付けられる辺を返す。
 * 「数字がそろったマスの残り」と「線が 2 本になった交点の残り」のみ。
 */
export function autoCrossEdges(grid, clues, state, changedEdges) {
  const result = [];
  const cells = new Set();
  const vertices = new Set();
  for (const e of changedEdges) {
    for (const cell of grid.edgeCells[e]) cells.add(cell);
    vertices.add(grid.edgeEnds[e * 2]);
    vertices.add(grid.edgeEnds[e * 2 + 1]);
  }
  for (const cell of cells) {
    const clue = clues[cell];
    if (clue < 0) continue;
    let lines = 0;
    for (let k = 0; k < 4; k++) if (state[grid.cellEdges[cell * 4 + k]] === LINE) lines++;
    if (lines !== clue) continue;
    for (let k = 0; k < 4; k++) {
      const e = grid.cellEdges[cell * 4 + k];
      if (state[e] === UNKNOWN) result.push(e);
    }
  }
  for (const v of vertices) {
    let lines = 0;
    for (const e of grid.vertexEdges[v]) if (state[e] === LINE) lines++;
    if (lines !== 2) continue;
    for (const e of grid.vertexEdges[v]) if (state[e] === UNKNOWN) result.push(e);
  }
  return [...new Set(result)];
}

// ヒントとして提示したい推論の順番 (人にとって分かりやすい順)
const RULE_PRIORITY = [
  'clue_full', 'clue_rest', 'vertex_two', 'vertex_pair', 'vertex_dead',
  'loop_closed', 'loop_done', 'assume_line', 'assume_cross',
];

/**
 * 次の一手を探す。
 * @returns {{type:'mistake'|'move'|'none'|'stuck', edge?:number, value?:number, message:string}}
 */
export function findHint(grid, clues, state, solution) {
  if (solution) {
    for (let e = 0; e < grid.edgeCount; e++) {
      if (state[e] === UNKNOWN) continue;
      if (state[e] !== solution[e]) {
        return {
          type: 'mistake',
          edge: e,
          value: solution[e],
          message: state[e] === LINE
            ? 'ここには線が通りません。まずこの線を消しましょう。'
            : 'ここには線が通ります。× を外しましょう。',
        };
      }
    }
  }

  for (const depth of [0, 1, 2]) {
    const res = solveLogical(grid, clues, { maxDepth: depth, initial: state, trackReasons: true });
    if (res.status === 'contradiction') {
      return { type: 'mistake', message: 'いまの盤面はどこかで矛盾しています。チェックを使ってみてください。' };
    }
    let best = -1;
    let bestRank = Infinity;
    for (let e = 0; e < grid.edgeCount; e++) {
      if (state[e] !== UNKNOWN) continue;
      const decided = res.state.edges[e];
      if (decided === UNKNOWN) continue;
      const reason = res.state.reasons[e] || 'assume_line';
      const rank = RULE_PRIORITY.indexOf(reason);
      const score = rank < 0 ? RULE_PRIORITY.length : rank;
      if (score < bestRank) { bestRank = score; best = e; }
      if (score === 0) break;
    }
    if (best >= 0) {
      const reason = res.state.reasons[best] || 'assume_line';
      return {
        type: 'move',
        edge: best,
        value: res.state.edges[best],
        message: RULE_LABELS[reason] || '論理的にここが決まります',
      };
    }
  }
  return { type: 'none', message: 'これ以上ヒントはありません。もう完成しているかもしれません。' };
}
