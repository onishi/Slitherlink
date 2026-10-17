import test from 'node:test';
import assert from 'node:assert/strict';
import { getGrid, isSingleLoop, cluesFromEdges, LINE } from '../src/core/grid.js';
import { solveLogical, countSolutions } from '../src/core/solver.js';
import { generatePuzzle, randomLoop, stretchLoop, makeRng, DIFFICULTIES, GENERATORS, LATEST_GENERATOR, gameGeneratorOptions } from '../src/core/generator.js';
import { difficultyReport, levelOf, problemStats } from '../src/core/difficulty-report.js';
import { teacherCheck, isPointSymmetric } from '../src/core/teacher.js';
import { thinkMoves, feelProfile, workRun } from '../src/core/feel.js';

test('randomLoop は必ず単一ループを返す', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rng = makeRng(seed * 7919);
    const loop = randomLoop(6, 6, rng);
    assert.ok(loop, 'ループ生成に失敗');
    assert.ok(isSingleLoop(loop.grid, loop.edges), `seed ${seed} で単一ループでない`);
  }
});

const cases = [
  { rows: 5, cols: 5, difficulty: 'intro' },
  { rows: 5, cols: 5, difficulty: 'easy' },
  { rows: 7, cols: 7, difficulty: 'easy' },
  { rows: 6, cols: 8, difficulty: 'normal' },
  { rows: 7, cols: 7, difficulty: 'normal' },
  { rows: 6, cols: 6, difficulty: 'hard' },
  // 5×5 の鬼は、内側と外側のルール（R5）を入れてから作りにくくなった（時間内に作れないことがある）ので 6×6 で確かめる
  { rows: 6, cols: 6, difficulty: 'expert' },
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

      // 解き味の分析で、ちょうど宣言した難易度になっている
      assert.equal(p.difficulty, c.difficulty, '狙いの難易度が作れなかった');
      assert.equal(levelOf(difficultyReport(p)), c.difficulty, '解き味が難易度と合わない');

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

test('教師データ：輪を盤いっぱいにくねらせ、数字を点対称に削り、教師データの条件を満たす', () => {
  const p = generatePuzzle({ rows: 10, cols: 10, difficulty: 'normal', style: 'teacher', seed: 4242, timeLimitMs: 30000 });
  assert.equal(p.difficulty, 'normal');
  assert.equal(p.styleOk, true);
  assert.ok(isPointSymmetric(p.clues, 10, 10));
  const st = problemStats(difficultyReport(p), p.solution, p);
  const check = teacherCheck({ rows: 10, cols: 10, clues: p.clues, clueCount: p.clueCount, ...st });
  assert.deepEqual(check.failed, []);
  assert.equal(check.ok, true);
  // 論理だけで解けて、解は 1 つ
  const g = getGrid(10, 10);
  assert.equal(countSolutions(g, p.clues, 2), 1);
});

test('教師データの条件：外れたものと、分からないものを分けて返す', () => {
  const base = { rows: 10, cols: 10, clueCount: 40, loopLength: 90, coverage: 90, largestGap: 1, patternShare: 99, assumeCount: 0 };
  assert.equal(teacherCheck(base).ok, null); // 数字の配置が分からないので、点対称かは分からない
  const clues = new Int8Array(100).fill(-1);
  clues[0] = 1; clues[99] = 2;
  assert.equal(teacherCheck({ ...base, clues }).ok, true);
  clues[1] = 3; // 対になる 98 番に数字が無い
  assert.deepEqual(teacherCheck({ ...base, clues }).failed, ['点対称']);
  assert.deepEqual(teacherCheck({ ...base, clues: undefined, clueCount: 60, largestGap: 9 }).failed, ['数字', '最大の空き地']);
});

test('stretchLoop：輪は 1 本のまま、マス数の 0.85 倍くらいまで長くなる', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const rng = makeRng(seed * 131);
    const loop = randomLoop(12, 12, rng);
    const before = loop.edges.reduce((a, b) => a + b, 0);
    const out = stretchLoop(loop, rng);
    const after = out.edges.reduce((a, b) => a + b, 0);
    assert.ok(isSingleLoop(out.grid, out.edges));
    assert.ok(after >= before);
    assert.ok(after >= 144 * 0.8, `輪の長さ ${after}`);
  }
});

test('教師データの入門：少し先を読む手があり、空の行・列や数字のない 3×3 が無い', () => {
  const p = generatePuzzle({ rows: 10, cols: 10, difficulty: 'intro', style: 'teacher', seed: 7000, timeLimitMs: 30000 });
  assert.equal(p.difficulty, 'intro');
  assert.ok(thinkMoves(p) >= 3, '考える手が少ない');
  assert.ok(isPointSymmetric(p.clues, 10, 10));
  const has = (r, c) => p.clues[r * 10 + c] >= 0;
  for (let i = 0; i < 10; i++) {
    assert.ok([...Array(10).keys()].some((j) => has(i, j)), `空の行 ${i}`);
    assert.ok([...Array(10).keys()].some((j) => has(j, i)), `空の列 ${i}`);
  }
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      let any = false;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) any ||= has(r + i, c + j);
      assert.ok(any, `数字のない 3×3（${r},${c}）`);
    }
  }
});

test('考える手：盤面を見ただけで解ける問題は 0、少し先を読む問題は 1 以上', () => {
  const easy = generatePuzzle({ rows: 6, cols: 6, difficulty: 'intro', seed: 11 });
  assert.equal(thinkMoves(easy), 0);
  const normal = generatePuzzle({ rows: 7, cols: 7, difficulty: 'normal', seed: 12 });
  assert.ok(thinkMoves(normal) >= 1);
});

test('教師データ v3：手触り（考える手の多さ・入り口・山場）と数字の内訳を教師データに寄せる', () => {
  const p = generatePuzzle({ rows: 10, cols: 10, difficulty: 'normal', style: 'teacher', version: 3, seed: 321, timeLimitMs: 30000 });
  assert.equal(p.difficulty, 'normal');
  assert.ok(isPointSymmetric(p.clues, 10, 10));
  const f = feelProfile(p);
  assert.ok(f.thinkRate <= 12 + 1e-9, `考える手 ${f.thinkRate}`);
  assert.ok(f.think >= 1);
  const h = [0, 0, 0, 0];
  for (const v of p.clues) if (v >= 0) h[v]++;
  assert.ok(h[3] > 0 && h[1] > 0);
});

test('作問ロジックの版：教師データ v8 が最新で、版を省くと最新で作る', () => {
  assert.equal(LATEST_GENERATOR, 'teacher-8');
  assert.deepEqual(GENERATORS['teacher-3'].options, { style: 'teacher', version: 3 });
  assert.deepEqual(GENERATORS['teacher-4'].options, { style: 'teacher', version: 4 });
  assert.deepEqual(GENERATORS['teacher-5'].options, { style: 'teacher', version: 5 });
  assert.deepEqual(GENERATORS['teacher-6'].options, { style: 'teacher', version: 6 });
  assert.deepEqual(GENERATORS['teacher-7'].options, { style: 'teacher', version: 7 });
  assert.deepEqual(GENERATORS['teacher-8'].options, { style: 'teacher', version: 8 });
});

test('教師データ v5：0 を固めずに置く（まわり 2 歩以内にほかの 0 がある 0 を残さない）', () => {
  const p = generatePuzzle({ rows: 10, cols: 10, difficulty: 'normal', style: 'teacher', version: 5, seed: 321, timeLimitMs: 30000 });
  assert.equal(p.difficulty, 'normal');
  assert.ok(isPointSymmetric(p.clues, 10, 10));
  const zero = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 10 && p.clues[r * 10 + c] === 0;
  let crowded = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      if (!zero(r, c)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        if ((dr || dc) && Math.abs(dr) + Math.abs(dc) <= 2 && zero(r + dr, c + dc)) crowded++;
      }
    }
  }
  assert.equal(crowded, 0);
  assert.equal(typeof p.workRun, 'number');
});

test('教師データ v6：ふつうは考える手を 100 本あたり 11 回までにする', () => {
  const p = generatePuzzle({ rows: 10, cols: 10, difficulty: 'normal', style: 'teacher', version: 6, seed: 321, timeLimitMs: 30000 });
  assert.equal(p.difficulty, 'normal');
  assert.ok(isPointSymmetric(p.clues, 10, 10));
  assert.ok(feelProfile(p).thinkRate <= 11 + 1e-9, `考える手 ${feelProfile(p).thinkRate}`);
});

test('ゲームの「作る」は入門〜ふつうが教師データ 8 版。むずかしい・鬼はランダム', () => {
  assert.deepEqual(gameGeneratorOptions(7, 7, 'normal'), { style: 'teacher', version: 8 });
  assert.deepEqual(gameGeneratorOptions(5, 5, 'intro'), { style: 'teacher', version: 8 });
  assert.deepEqual(gameGeneratorOptions(15, 15, 'hard'), {});
  assert.deepEqual(gameGeneratorOptions(10, 10, 'expert'), {});
});

test('輪を曲げる（7 版）：長さはそのまま、曲がる点が増える', () => {
  const turnRate = (loop) => {
    const { grid, edges } = loop;
    let turns = 0;
    let pts = 0;
    for (let v = 0; v < grid.vertexCount; v++) {
      const es = grid.vertexEdges[v].filter((e) => edges[e] === 1);
      if (es.length !== 2) continue;
      pts++;
      if (grid.edgeInfo[es[0]].dir !== grid.edgeInfo[es[1]].dir) turns++;
    }
    return turns / pts;
  };
  let plain = 0;
  let bent = 0;
  for (let s = 1; s <= 6; s++) {
    const a = stretchLoop(randomLoop(12, 12, makeRng(s)), makeRng(s + 100));
    const b = stretchLoop(randomLoop(12, 12, makeRng(s)), makeRng(s + 100), { bend: true });
    assert.ok(isSingleLoop(b.grid, b.edges));
    plain += turnRate(a);
    bent += turnRate(b);
  }
  assert.ok(bent > plain, `曲がり ${bent / 6} ≤ ${plain / 6}`);
});

test('作業の続く区間：盤面を見ただけで × が続く手数を数える', () => {
  const p = generatePuzzle({ rows: 6, cols: 6, difficulty: 'normal', seed: 5 });
  const run = workRun(p);
  assert.ok(run >= 1 && run <= 60, `作業の続く区間 ${run}`);
  assert.equal(workRun(p, 2), Math.min(run, 2));
});

test('教師データ v4：入門は考える手を軽めに（決まる辺 100 本あたり 8 回くらいまで）', () => {
  const p = generatePuzzle({ rows: 10, cols: 10, difficulty: 'intro', style: 'teacher', version: 4, seed: 77, timeLimitMs: 30000 });
  assert.equal(p.difficulty, 'intro');
  assert.ok(isPointSymmetric(p.clues, 10, 10));
  const f = feelProfile(p);
  assert.ok(f.thinkRate <= 8 + 1e-9, `考える手 ${f.thinkRate}`);
});
