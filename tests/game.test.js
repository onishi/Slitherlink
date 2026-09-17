import test from 'node:test';
import assert from 'node:assert/strict';
import { getGrid, UNKNOWN, LINE, CROSS } from '../src/core/grid.js';
import { analyze, autoCrossEdges, findHint } from '../src/core/game.js';
import { generatePuzzle } from '../src/core/generator.js';

function fresh(size = 6, difficulty = 'normal', seed = 8080) {
  const p = generatePuzzle({ rows: size, cols: size, difficulty, seed });
  const g = getGrid(size, size);
  return { p, g, state: new Int8Array(g.edgeCount) };
}

test('正解を並べると solved になる', () => {
  const { p, g } = fresh();
  const state = Int8Array.from(p.solution);
  const a = analyze(g, p.clues, state);
  assert.equal(a.solved, true);
  assert.equal(a.badCells.length, 0);
  assert.equal(a.satisfied, a.total);
});

test('空の盤面は solved でない', () => {
  const { p, g, state } = fresh();
  assert.equal(analyze(g, p.clues, state).solved, false);
});

test('数字を超える線は矛盾として検出される', () => {
  const g = getGrid(2, 2);
  const clues = new Int8Array([0, -1, -1, -1]);
  const state = new Int8Array(g.edgeCount);
  state[g.h(0, 0)] = LINE;
  assert.deepEqual(analyze(g, clues, state).badCells, [0]);
});

test('交点に線が 3 本集まると矛盾として検出される', () => {
  const g = getGrid(2, 2);
  const clues = new Int8Array(4).fill(-1);
  const state = new Int8Array(g.edgeCount);
  state[g.h(1, 0)] = LINE;
  state[g.h(1, 1)] = LINE;
  state[g.v(0, 1)] = LINE;
  const a = analyze(g, clues, state);
  assert.equal(a.badVertices.length, 1);
});

test('数字がそろったら残りの辺を自動で × にできる', () => {
  const g = getGrid(2, 2);
  const clues = new Int8Array([1, -1, -1, -1]);
  const state = new Int8Array(g.edgeCount);
  const e = g.h(0, 0);
  state[e] = LINE;
  const crosses = autoCrossEdges(g, clues, state, [e]);
  assert.equal(crosses.length, 3);
  assert.ok(!crosses.includes(e));
});

test('ヒントは論理的に正しい一手を返す', () => {
  const { p, g, state } = fresh(6, 'easy', 4321);
  for (let i = 0; i < 20; i++) {
    const hint = findHint(g, p.clues, state, p.solution);
    if (hint.type === 'none') break;
    assert.equal(hint.type, 'move', hint.message);
    assert.equal(hint.value, p.solution[hint.edge], 'ヒントが正解と食い違う');
    assert.ok(hint.message.length > 0);
    state[hint.edge] = hint.value;
  }
});

test('ヒントは間違いを先に指摘する', () => {
  const { p, g, state } = fresh(6, 'normal', 1212);
  let wrong = -1;
  for (let e = 0; e < g.edgeCount; e++) if (p.solution[e] === CROSS) { wrong = e; break; }
  state[wrong] = LINE;
  const hint = findHint(g, p.clues, state, p.solution);
  assert.equal(hint.type, 'mistake');
  assert.equal(hint.edge, wrong);
});

test('ヒントを繰り返せば最後まで解ける', () => {
  const { p, g, state } = fresh(6, 'normal', 777);
  for (let i = 0; i < 4000; i++) {
    if (analyze(g, p.clues, state).solved) break;
    const hint = findHint(g, p.clues, state, p.solution);
    if (hint.type !== 'move') break;
    state[hint.edge] = hint.value;
  }
  assert.equal(analyze(g, p.clues, state).solved, true);
});
