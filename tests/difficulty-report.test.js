import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePuzzle } from '../src/core/generator.js';
import { difficultyReport, rateImported, problemStats } from '../src/core/difficulty-report.js';
import { decodePuzzle } from '../src/core/puzzle.js';

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

test('難易度ごとの解き味：入門は定石だけ、むずかしいは仮定 1 段、鬼は仮定 2 段が要る', () => {
  const intro = difficultyReport(generatePuzzle({ rows: 7, cols: 7, difficulty: 'intro', seed: 99 }));
  assert.equal(intro.assumeCount, 0);
  assert.equal(intro.decided.rule + intro.decided.search, 0);
  const hard = difficultyReport(generatePuzzle({ rows: 6, cols: 6, difficulty: 'hard', seed: 99 }));
  assert.ok(hard.assumeCount > 0);
  assert.equal(hard.deepCount, 0);
  const expert = difficultyReport(generatePuzzle({ rows: 5, cols: 5, difficulty: 'expert', seed: 99 }));
  assert.ok(expert.deepCount > 0);
});

test('持ち込まれた問題に、解き味から難易度を付ける', () => {
  const p = generatePuzzle({ rows: 6, cols: 6, difficulty: 'normal', seed: 5 });
  const r = rateImported({ rows: 6, cols: 6, clues: p.clues });
  assert.equal(r.status, 'ok');
  assert.equal(r.difficulty, 'normal');
});

test('問題集にしまう目安：仮定の要らない問題と、要る問題', () => {
  const easy = rateImported(decodePuzzle('5eJgCYLgA'));
  assert.deepEqual(problemStats(easy.report, easy.solution),
    { loopLength: 14, patternShare: 55, freeShare: 100, assumeCount: 0, longestSteps: 0 });
  const hard = rateImported(decodePuzzle('7hpQrYVs0MqirBdlwA'));
  assert.equal(hard.difficulty, 'hard');
  const st = problemStats(hard.report, hard.solution);
  assert.equal(st.loopLength, 46);
  assert.ok(st.freeShare < 100 && st.freeShare > 0);
  assert.ok(st.assumeCount >= 1 && st.longestSteps >= 1);
  assert.ok(st.patternShare > 0 && st.patternShare <= 100);
});
