import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePuzzle, decodePuzzle, solutionFor } from '../src/core/puzzle.js';
import { generatePuzzle } from '../src/core/generator.js';

test('エンコードとデコードで内容が保たれる', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    const p = generatePuzzle({ rows: 6, cols: 5, difficulty: diff, seed: 77 });
    const code = encodePuzzle(p);
    const back = decodePuzzle(code);
    assert.equal(back.rows, p.rows);
    assert.equal(back.cols, p.cols);
    assert.equal(back.difficulty, diff);
    assert.deepEqual([...back.clues], [...p.clues]);
  }
});

test('空白だらけでも往復できる', () => {
  const clues = new Int8Array(60).fill(-1);
  clues[0] = 3;
  clues[59] = 0;
  const code = encodePuzzle({ rows: 6, cols: 10, difficulty: 'normal', clues });
  assert.deepEqual([...decodePuzzle(code).clues], [...clues]);
});

test('壊れたコードは弾く', () => {
  assert.throws(() => decodePuzzle('abc'));
  assert.throws(() => decodePuzzle('5x5:n:9999'));
  assert.throws(() => decodePuzzle('5x5:n:a')); // 長さ不足
});

test('コードから正解を復元できる', () => {
  const p = generatePuzzle({ rows: 6, cols: 6, difficulty: 'normal', seed: 2024 });
  const restored = solutionFor(decodePuzzle(encodePuzzle(p)));
  assert.ok(restored);
  assert.deepEqual([...restored], [...p.solution]);
});
