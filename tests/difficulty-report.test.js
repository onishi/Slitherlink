import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePuzzle } from '../src/core/generator.js';
import { difficultyReport, rateImported, problemStats } from '../src/core/difficulty-report.js';
import { decodePuzzle } from '../src/core/puzzle.js';
import { getGrid } from '../src/core/grid.js';

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

test('最大の空き地：線の通らないマスが上下左右でつながったかたまりのうち、いちばん大きいもの', () => {
  const grid = getGrid(3, 3);
  const report = { decided: { plain: 1, search: 0 }, total: 1, beforeAssume: 1, assumeCount: 0, longest: 0 };
  // 左上の 1 マスだけを囲む輪：線に触れるのは左上と、その右・下の 3 マス。残り 6 マスは 1 つにつながる
  const sol = new Int8Array(grid.edgeCount).fill(2);
  for (let k = 0; k < 4; k++) sol[grid.cellEdges[k]] = 1;
  const st = problemStats(report, sol, { rows: 3, cols: 3 });
  assert.equal(st.coverage, 33);
  assert.equal(st.largestGap, 66.7);
  // 盤の外周をまわる輪：真ん中の 1 マスだけが空き
  const ring = new Int8Array(grid.edgeCount).fill(2);
  for (let c = 0; c < 3; c++) { ring[grid.h(0, c)] = 1; ring[grid.h(3, c)] = 1; }
  for (let r = 0; r < 3; r++) { ring[grid.v(r, 0)] = 1; ring[grid.v(r, 3)] = 1; }
  assert.equal(problemStats(report, ring, { rows: 3, cols: 3 }).largestGap, 11.1);
});

test('持ち込まれた問題に、解き味から難易度を付ける', () => {
  const p = generatePuzzle({ rows: 6, cols: 6, difficulty: 'normal', seed: 5 });
  const r = rateImported({ rows: 6, cols: 6, clues: p.clues });
  assert.equal(r.status, 'ok');
  assert.equal(r.difficulty, 'normal');
});

test('問題集にしまう目安：仮定の要らない問題と、要る問題', () => {
  const easy = rateImported(decodePuzzle('5eJgCYLgA'));
  assert.deepEqual(problemStats(easy.report, easy.solution, { rows: 5, cols: 5 }),
    { coverage: 44, largestGap: 56, loopLength: 14, patternShare: 55, freeShare: 100, assumeCount: 0, longestSteps: 0 });
  // 大きさが分からなければ行き渡り率・最大の空き地は出さない
  assert.equal(problemStats(easy.report, easy.solution).coverage, null);
  assert.equal(problemStats(easy.report, easy.solution).largestGap, null);
  const hard = rateImported(decodePuzzle('7hpQrYVs0MqirBdlwA'));
  assert.equal(hard.difficulty, 'hard');
  const st = problemStats(hard.report, hard.solution, { rows: 7, cols: 7 });
  assert.ok(st.coverage > 0 && st.coverage <= 100);
  assert.equal(st.loopLength, 46);
  assert.ok(st.freeShare < 100 && st.freeShare > 0);
  assert.ok(st.assumeCount >= 1 && st.longestSteps >= 1);
  assert.ok(st.patternShare > 0 && st.patternShare <= 100);
});
