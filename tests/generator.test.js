import test from 'node:test';
import assert from 'node:assert/strict';
import { getGrid, isSingleLoop, cluesFromEdges, LINE } from '../src/core/grid.js';
import { solveLogical, countSolutions } from '../src/core/solver.js';
import { generatePuzzle, randomLoop, makeRng, DIFFICULTIES } from '../src/core/generator.js';

test('randomLoop は必ず単一ループを返す', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rng = makeRng(seed * 7919);
    const loop = randomLoop(6, 6, rng);
    assert.ok(loop, 'ループ生成に失敗');
    assert.ok(isSingleLoop(loop.grid, loop.edges), `seed ${seed} で単一ループでない`);
  }
});

const cases = [
  { rows: 5, cols: 5, difficulty: 'easy' },
  { rows: 7, cols: 7, difficulty: 'easy' },
  { rows: 6, cols: 8, difficulty: 'normal' },
  { rows: 7, cols: 7, difficulty: 'normal' },
  { rows: 6, cols: 6, difficulty: 'hard' },
];

for (const c of cases) {
  test(`${c.rows}x${c.cols} ${c.difficulty}: 論理だけで解ける・解が一意`, () => {
    for (let i = 0; i < 3; i++) {
      const p = generatePuzzle({ ...c, seed: 4242 + i * 101 });
      const g = getGrid(p.rows, p.cols);

      // 正解は単一ループ
      const loopEdges = new Uint8Array(g.edgeCount);
      for (let e = 0; e < g.edgeCount; e++) loopEdges[e] = p.solution[e] === LINE ? 1 : 0;
      assert.ok(isSingleLoop(g, loopEdges), '正解が単一ループでない');

      // 残った数字は正解と矛盾しない
      const full = cluesFromEdges(g, loopEdges);
      for (let cell = 0; cell < g.cellCount; cell++) {
        if (p.clues[cell] >= 0) assert.equal(p.clues[cell], full[cell]);
      }

      // 宣言した難易度の推論だけで最後まで解ける
      const depth = DIFFICULTIES[c.difficulty].depth;
      const res = solveLogical(g, p.clues, { maxDepth: depth });
      assert.equal(res.status, 'solved', '論理だけで解けない問題が生成された');
      for (let e = 0; e < g.edgeCount; e++) {
        assert.equal(res.state.edges[e], p.solution[e], '論理解と正解が食い違う');
      }

      // 解は一意
      assert.equal(countSolutions(g, p.clues, 2), 1, '解が一意でない');

      // 数字が全部残っている (=削れていない) ということはない
      assert.ok(p.clueCount < g.cellCount, '数字が一つも削られていない');
    }
  });
}

test('やさしいは背理法なしで解ける', () => {
  const p = generatePuzzle({ rows: 7, cols: 7, difficulty: 'easy', seed: 999 });
  const g = getGrid(7, 7);
  assert.equal(solveLogical(g, p.clues, { maxDepth: 0 }).status, 'solved');
});

test('同じ seed からは同じ問題ができる', () => {
  const a = generatePuzzle({ rows: 6, cols: 6, difficulty: 'normal', seed: 31337 });
  const b = generatePuzzle({ rows: 6, cols: 6, difficulty: 'normal', seed: 31337 });
  assert.deepEqual([...a.clues], [...b.clues]);
});
