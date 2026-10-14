import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePuzzle } from '../src/core/generator.js';
import { difficultyReport } from '../src/core/difficulty-report.js';

test('解き味の分析：最後まで解け、内訳の合計が辺の数になる', () => {
  for (const [n, difficulty] of [[5, 'easy'], [7, 'normal'], [7, 'hard']]) {
    const p = generatePuzzle({ rows: n, cols: n, difficulty, seed: 321 });
    const r = difficultyReport(p);
    assert.ok(r.solved, `${n}x${n} ${difficulty} が解き切れない`);
    const sum = Object.values(r.decided).reduce((a, b) => a + b, 0);
    assert.equal(sum, r.total);
    assert.ok(r.beforeAssume > 0 && r.beforeAssume <= 1);
    assert.equal(r.assumeCount, r.stalls.length);
  }
});

test('やさしい問題は仮定なしで解ける', () => {
  const p = generatePuzzle({ rows: 7, cols: 7, difficulty: 'easy', seed: 99 });
  const r = difficultyReport(p);
  assert.equal(r.assumeCount, 0);
  assert.equal(r.beforeAssume, 1);
});
