import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrid, boundaryEdges, cluesFromEdges, LINE, CROSS } from '../src/core/grid.js';
import { solveLogical, countSolutions } from '../src/core/solver.js';

function ring(rows, cols, cells) {
  const g = createGrid(rows, cols);
  const inside = new Uint8Array(rows * cols);
  for (const [r, c] of cells) inside[r * cols + c] = 1;
  const edges = boundaryEdges(g, inside);
  return { g, edges, clues: cluesFromEdges(g, edges) };
}

test('全部の数字があれば伝播だけで解ける', () => {
  const { g, edges, clues } = ring(4, 4, [[1, 1], [1, 2], [2, 1], [2, 2], [3, 2]]);
  const res = solveLogical(g, clues, { maxDepth: 0 });
  assert.equal(res.status, 'solved');
  for (let e = 0; e < g.edgeCount; e++) {
    assert.equal(res.state.edges[e], edges[e] === 1 ? LINE : CROSS);
  }
});

test('矛盾する問題は contradiction を返す', () => {
  const g = createGrid(2, 2);
  const clues = new Int8Array([4, 4, -1, -1]); // 隣り合う 4 は成立しない
  assert.equal(solveLogical(g, clues, { maxDepth: 1 }).status, 'contradiction');
});

test('中央の 4 だけで 1 マスの輪に確定する', () => {
  const g = createGrid(3, 3);
  const clues = new Int8Array(9).fill(-1);
  clues[4] = 4;
  const res = solveLogical(g, clues, { maxDepth: 0 });
  assert.equal(res.status, 'solved');
  assert.equal(countSolutions(g, clues, 3), 1);
});

test('0 に囲まれた 4 は矛盾する', () => {
  const g = createGrid(3, 3);
  const clues = new Int8Array(9).fill(0);
  clues[4] = 4;
  assert.equal(solveLogical(g, clues, { maxDepth: 0 }).status, 'contradiction');
  assert.equal(countSolutions(g, clues, 3), 0);
});

test('解が存在しない問題は 0 件', () => {
  const g = createGrid(1, 1);
  const clues = new Int8Array([3]); // 1x1 の輪は必ず 4 本
  assert.equal(countSolutions(g, clues, 3), 0);
});

test('手がかりが足りない問題は複数解になる', () => {
  const g = createGrid(2, 2);
  const clues = new Int8Array([1, -1, -1, -1]);
  assert.ok(countSolutions(g, clues, 5) > 1);
});

test('部分的に手が入った状態から続きを推論できる', () => {
  const { g, edges, clues } = ring(4, 4, [[1, 1], [1, 2], [2, 2]]);
  const initial = new Int8Array(g.edgeCount);
  let placed = 0;
  for (let e = 0; e < g.edgeCount && placed < 3; e++) {
    if (edges[e] === 1) { initial[e] = LINE; placed++; }
  }
  const res = solveLogical(g, clues, { maxDepth: 1, initial });
  assert.equal(res.status, 'solved');
});

test('誤った既知情報は矛盾として検出される', () => {
  const { g, edges, clues } = ring(4, 4, [[1, 1], [1, 2], [2, 2]]);
  const initial = new Int8Array(g.edgeCount);
  for (let e = 0; e < g.edgeCount; e++) {
    if (edges[e] !== 1) { initial[e] = LINE; break; } // 解に無い場所へ線を引く
  }
  assert.equal(solveLogical(g, clues, { maxDepth: 1, initial }).status, 'contradiction');
});

test('内側と外側（R5）：確定した辺をたどって両側の内外が分かれば、間の辺が決まる', async () => {
  const { getGrid, LINE, CROSS, UNKNOWN } = await import('../src/core/grid.js');
  const { SolveState } = await import('../src/core/solver.js');
  // 2×2 の盤。左上のマスの上と左を線、右上のマスの上を × にすると、
  // 左上は内側・右上は外側と分かるので、その間の辺は線
  const grid = getGrid(2, 2);
  const st = new SolveState(grid, new Int8Array(4).fill(-1), true);
  const top0 = grid.cellEdges[0 * 4 + 0];
  const top1 = grid.cellEdges[1 * 4 + 0];
  const between = grid.cellEdges.slice(0, 4).find((e) => grid.edgeCells[e].includes(1));
  assert.ok(st.setEdge(top0, LINE, 'given'));
  assert.ok(st.setEdge(top1, CROSS, 'given'));
  assert.equal(st.edges[between], UNKNOWN);
  // ほかのルール（線の端はつながる）でも同じ辺が決まるので、R5 だけを当てて確かめる
  assert.ok(st.applyParityRule());
  assert.equal(st.edges[between], LINE);
  assert.equal(st.reasons[between].rule, 'parity');
  assert.deepEqual(new Set(st.reasons[between].premises), new Set([top0, top1]));
});

test('内側と外側（R5）：つじつまが合わなければ矛盾', async () => {
  const { getGrid, LINE, CROSS } = await import('../src/core/grid.js');
  const { SolveState } = await import('../src/core/solver.js');
  const grid = getGrid(2, 2);
  const st = new SolveState(grid, new Int8Array(4).fill(-1), true);
  const top0 = grid.cellEdges[0];
  const top1 = grid.cellEdges[4];
  const between = grid.cellEdges.slice(0, 4).find((e) => grid.edgeCells[e].includes(1));
  assert.ok(st.setEdge(top0, LINE, 'given'));
  assert.ok(st.setEdge(top1, CROSS, 'given'));
  // 左上（内）と右上（外）の間を × にすると食い違う
  assert.equal(st.setEdge(between, CROSS, 'given'), false);
  assert.equal(st.clash.kind, 'parity');
});
