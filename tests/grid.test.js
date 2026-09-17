import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrid, boundaryEdges, isSingleLoop, cluesFromEdges } from '../src/core/grid.js';

test('辺と頂点の数が正しい', () => {
  const g = createGrid(3, 4);
  assert.equal(g.hCount, 4 * 4);
  assert.equal(g.vCount, 3 * 5);
  assert.equal(g.edgeCount, 16 + 15);
  assert.equal(g.vertexCount, 4 * 5);
});

test('各辺はちょうど 2 つの頂点につながる', () => {
  const g = createGrid(4, 4);
  let total = 0;
  for (let v = 0; v < g.vertexCount; v++) total += g.vertexEdges[v].length;
  assert.equal(total, g.edgeCount * 2);
});

test('1 マスの境界は単一ループになる', () => {
  const g = createGrid(3, 3);
  const inside = new Uint8Array(9);
  inside[4] = 1;
  const edges = boundaryEdges(g, inside);
  assert.ok(isSingleLoop(g, edges));
  const clues = cluesFromEdges(g, edges);
  assert.equal(clues[4], 4);
  assert.equal(clues[1], 1);
  assert.equal(clues[0], 0);
});

test('穴のあいた領域は単一ループにならない', () => {
  const g = createGrid(3, 3);
  const inside = new Uint8Array(9).fill(1);
  inside[4] = 0; // ドーナツ型 → 輪が 2 本
  assert.equal(isSingleLoop(g, boundaryEdges(g, inside)), false);
});

test('斜めにつながる領域 (くびれ) は単一ループにならない', () => {
  const g = createGrid(2, 2);
  const inside = new Uint8Array(4);
  inside[0] = 1;
  inside[3] = 1;
  assert.equal(isSingleLoop(g, boundaryEdges(g, inside)), false);
});
