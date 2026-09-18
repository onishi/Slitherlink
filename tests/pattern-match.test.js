import test from 'node:test';
import assert from 'node:assert/strict';
import { getGrid, UNKNOWN, LINE, CROSS } from '../src/core/grid.js';
import { countSolutions, solveLogical } from '../src/core/solver.js';
import { PATTERNS, buildPattern } from '../src/core/patterns.js';
import { orientationsOf, findMatches, transformPattern } from '../src/core/pattern-match.js';
import { generatePuzzle } from '../src/core/generator.js';

const templates = PATTERNS.filter((p) => p.match !== 'loop');

test('回転・反転しても定石は成り立つ', () => {
  for (const pattern of templates) {
    for (const variant of orientationsOf(pattern)) {
      const { grid, clues, given, conclude } = buildPattern(variant);
      assert.ok(
        countSolutions(grid, clues, 1, given) > 0,
        `${pattern.id} (向き ${variant.transform}): 前提に解が無い`,
      );
      for (const { edge, value } of conclude) {
        const probe = Int8Array.from(given);
        probe[edge] = value === LINE ? CROSS : LINE;
        assert.equal(
          countSolutions(grid, clues, 1, probe), 0,
          `${pattern.id} (向き ${variant.transform}): 変換後に結論が確定しない`,
        );
      }
    }
  }
});

test('変換は数字と印の数を保つ', () => {
  for (const pattern of templates) {
    for (const variant of orientationsOf(pattern)) {
      assert.equal(variant.clues.length, pattern.clues.length, pattern.id);
      assert.equal(variant.given.length, pattern.given.length, pattern.id);
      assert.equal(variant.conclude.length, pattern.conclude.length, pattern.id);
      assert.equal(variant.rows * variant.cols, pattern.rows * pattern.cols, pattern.id);
    }
  }
});

test('角の定石は盤の角に置いたときだけ当てはまる', () => {
  const grid = getGrid(6, 6);
  const clues = new Int8Array(36).fill(-1);
  const state = new Int8Array(grid.edgeCount);
  const corner = PATTERNS.find((p) => p.id === 'corner-three');

  // 盤の真ん中の 3 には当てはまらない
  clues[2 * 6 + 2] = 3;
  assert.equal(findMatches(grid, clues, state, corner).fills.length, 0);

  // 角の 3 には当てはまる
  clues[2 * 6 + 2] = -1;
  clues[0] = 3;
  const hit = findMatches(grid, clues, state, corner);
  assert.equal(hit.fills.length, 2);
  for (const { edge, value } of hit.fills) {
    assert.equal(value, LINE);
    assert.ok([grid.h(0, 0), grid.v(0, 0)].includes(edge), '角以外の辺を埋めようとしている');
  }
});

test('角の定石は 4 つの角すべてで当てはまる', () => {
  const grid = getGrid(6, 6);
  const corner = PATTERNS.find((p) => p.id === 'corner-one');
  const corners = [[0, 0], [0, 5], [5, 0], [5, 5]];
  for (const [r, c] of corners) {
    const clues = new Int8Array(36).fill(-1);
    clues[r * 6 + c] = 1;
    const state = new Int8Array(grid.edgeCount);
    const { fills } = findMatches(grid, clues, state, corner);
    assert.equal(fills.length, 2, `角 (${r},${c}) で当てはまらない`);
    for (const f of fills) assert.equal(f.value, CROSS);
  }
});

/**
 * いちばん大事なテスト。実際に生成した問題へ全定石を当てはめ続け、
 * 埋めた辺が 1 本でも正解と食い違ったら落とす。
 */
const cases = [
  { rows: 5, cols: 5, difficulty: 'easy' },
  { rows: 7, cols: 7, difficulty: 'easy' },
  { rows: 7, cols: 7, difficulty: 'normal' },
  { rows: 6, cols: 8, difficulty: 'normal' },
  { rows: 10, cols: 10, difficulty: 'normal' },
];

for (const c of cases) {
  test(`${c.rows}x${c.cols} ${c.difficulty}: 定石が正解と違う辺を埋めない`, () => {
    for (let i = 0; i < 4; i++) {
      const puzzle = generatePuzzle({ ...c, seed: 5150 + i * 613 });
      const grid = getGrid(puzzle.rows, puzzle.cols);
      const state = new Int8Array(grid.edgeCount);
      let filled = 0;

      for (let round = 0; round < 200; round++) {
        let progressed = false;
        for (const pattern of PATTERNS) {
          const { fills, conflicts } = findMatches(grid, clues(puzzle), state, pattern);
          assert.equal(conflicts, 0, `${pattern.id}: 正しい盤面なのに矛盾を報告した`);
          for (const { edge, value } of fills) {
            assert.equal(
              value, puzzle.solution[edge],
              `${pattern.id} が正解と違う値を埋めようとした（辺 ${edge}）`,
            );
            state[edge] = value;
            filled++;
            progressed = true;
          }
        }
        if (!progressed) break;
      }
      // どの定石も当てはまらない問題はありうるので、ここでは本数を問わない
      assert.ok(filled >= 0);
    }
  });
}

test('生成した問題のほとんどで、定石がどれか 1 つは当てはまる', () => {
  let puzzles = 0;
  let withAny = 0;
  for (const [rows, cols, difficulty] of [[5, 5, 'easy'], [7, 7, 'normal'], [10, 10, 'normal']]) {
    for (let i = 0; i < 4; i++) {
      const puzzle = generatePuzzle({ rows, cols, difficulty, seed: 900 + i * 37 + rows });
      const grid = getGrid(rows, cols);
      const state = new Int8Array(grid.edgeCount);
      puzzles++;
      const any = PATTERNS.some((p) => findMatches(grid, puzzle.clues, state, p).fills.length > 0);
      if (any) withAny++;
    }
  }
  assert.ok(withAny / puzzles >= 0.7, `当てはまった問題は ${withAny}/${puzzles} しかない`);
});

test('すべての定石が、どこかの問題で実際に使われる', () => {
  const used = new Set();
  for (const [rows, cols, difficulty] of [[5, 5, 'easy'], [7, 7, 'easy'], [7, 7, 'normal'], [10, 10, 'normal']]) {
    for (let i = 0; i < 6; i++) {
      const puzzle = generatePuzzle({ rows, cols, difficulty, seed: 900 + i * 37 + rows });
      const grid = getGrid(rows, cols);
      const state = new Int8Array(grid.edgeCount);
      for (let round = 0; round < 120; round++) {
        let progressed = false;
        for (const pattern of PATTERNS) {
          const { fills } = findMatches(grid, puzzle.clues, state, pattern);
          if (!fills.length) continue;
          used.add(pattern.id);
          for (const { edge, value } of fills) state[edge] = value;
          progressed = true;
        }
        if (!progressed) break;
      }
    }
  }
  const unused = PATTERNS.filter((p) => !used.has(p.id)).map((p) => p.id);
  assert.deepEqual(unused, [], `一度も使われない定石がある: ${unused.join(', ')}`);
});

const clues = (puzzle) => puzzle.clues;

test('途中まで解いた盤面から当てはめても正解と食い違わない', () => {
  const puzzle = generatePuzzle({ rows: 8, cols: 8, difficulty: 'normal', seed: 24680 });
  const grid = getGrid(8, 8);
  // 論理ソルバで途中まで進めた状態を作り、そこから定石を当てはめる
  const partial = solveLogical(grid, puzzle.clues, { maxDepth: 0, budget: 1 });
  const state = Int8Array.from(partial.state.edges);
  for (const pattern of PATTERNS) {
    const { fills, conflicts } = findMatches(grid, puzzle.clues, state, pattern);
    assert.equal(conflicts, 0, `${pattern.id}: 途中の盤面で矛盾を報告した`);
    for (const { edge, value } of fills) {
      assert.equal(value, puzzle.solution[edge], `${pattern.id} が途中の盤面で誤った辺を埋めた`);
    }
  }
});

test('空白のない盤面では当てはまる場所が無くなる', () => {
  const puzzle = generatePuzzle({ rows: 6, cols: 6, difficulty: 'normal', seed: 1357 });
  const grid = getGrid(6, 6);
  const state = Int8Array.from(puzzle.solution);
  for (const pattern of PATTERNS) {
    const { fills } = findMatches(grid, puzzle.clues, state, pattern);
    assert.equal(fills.length, 0, `${pattern.id}: 完成後なのに埋める場所を返した`);
  }
});
