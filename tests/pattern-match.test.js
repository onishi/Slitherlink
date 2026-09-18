import test from 'node:test';
import assert from 'node:assert/strict';
import { getGrid, UNKNOWN, LINE, CROSS } from '../src/core/grid.js';
import { countSolutions, solveLogical } from '../src/core/solver.js';
import { PATTERNS, buildPattern } from '../src/core/patterns.js';
import { orientationsOf, findMatches, transformPattern } from '../src/core/pattern-match.js';
import { generatePuzzle } from '../src/core/generator.js';

const templates = PATTERNS.filter((p) => !p.match); // 型で照合するものだけ

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

test('「輪はひとつだけ」に頼る結論は、条件がそろったときだけ使う', () => {
  const threeThree = PATTERNS.find((p) => p.id === 'three-three');
  assert.ok(threeThree.loopConclude, 'three-three に loopConclude が無い');

  const mid = (grid) => grid.v(1, 2);
  const build = (rows, cols, extra = []) => {
    const grid = getGrid(rows, cols);
    const clues = new Int8Array(rows * cols).fill(-1);
    clues[1 * cols + 1] = 3;
    clues[1 * cols + 2] = 3;
    for (const [r, c, n] of extra) clues[r * cols + c] = n;
    return { grid, clues, state: new Int8Array(grid.edgeCount) };
  };

  // 3-3 しか数字が無い盤面: 2 マスを囲む長方形の輪が答えになりうるので、境目は決めない
  {
    const { grid, clues, state } = build(3, 4);
    const { fills } = findMatches(grid, clues, state, threeThree);
    assert.ok(!fills.some((f) => f.edge === mid(grid)), '長方形が答えになりうるのに境目を埋めた');
  }
  // ほかの数字が 0 だけでも、長方形の輪で 0 は満たせるので決めない
  {
    const { grid, clues, state } = build(4, 6, [[3, 5, 0]]);
    const { fills } = findMatches(grid, clues, state, threeThree);
    assert.ok(!fills.some((f) => f.edge === mid(grid)), '0 しか無いのに境目を埋めた');
  }
  // どこかに 1 / 2 / 3 があれば、長方形は答えになれないので境目は線
  for (const n of [1, 2, 3]) {
    const { grid, clues, state } = build(4, 6, [[3, 5, n]]);
    const { fills } = findMatches(grid, clues, state, threeThree);
    const hit = fills.find((f) => f.edge === mid(grid));
    assert.ok(hit, `離れた場所に ${n} があるのに境目を埋めない`);
    assert.equal(hit.value, LINE);
  }
});

test('実際の問題では、となり合う 3-3 の境目が線として埋まる', () => {
  const threeThree = PATTERNS.find((p) => p.id === 'three-three');
  let pairs = 0;
  for (const [rows, cols, difficulty] of [[7, 7, 'normal'], [10, 10, 'normal'], [12, 12, 'normal']]) {
    for (let i = 0; i < 6; i++) {
      const puzzle = generatePuzzle({ rows, cols, difficulty, seed: 3000 + i * 71 + rows });
      const grid = getGrid(rows, cols);
      const state = new Int8Array(grid.edgeCount);
      const { fills } = findMatches(grid, puzzle.clues, state, threeThree);
      for (const { edge, value } of fills) {
        assert.equal(value, puzzle.solution[edge], 'となり合う 3-3 が正解と違う辺を埋めた');
      }
      // 境目が埋まっているか数える
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c + 1 < cols; c++) {
          if (puzzle.clues[r * cols + c] !== 3 || puzzle.clues[r * cols + c + 1] !== 3) continue;
          pairs++;
          assert.ok(
            fills.some((f) => f.edge === grid.v(r, c + 1) && f.value === LINE),
            `(${r},${c}) の 3-3 で境目を埋めていない`,
          );
        }
      }
    }
  }
  assert.ok(pairs > 0, 'となり合う 3-3 が 1 組も現れなかった');
});

test('ルールを直接当てはめる定石が、正解と違う辺を埋めない', () => {
  const rules = PATTERNS.filter((p) => p.match === 'vertex' || p.match === 'bridge');
  assert.equal(rules.length, 2, 'ルール適用型の定石が 2 つでない');
  let filled = 0;

  for (const [rows, cols, difficulty] of [[5, 5, 'easy'], [7, 7, 'normal'], [10, 10, 'normal']]) {
    for (let i = 0; i < 4; i++) {
      const puzzle = generatePuzzle({ rows, cols, difficulty, seed: 8100 + i * 41 + rows });
      const grid = getGrid(rows, cols);
      const state = new Int8Array(grid.edgeCount);

      // 型の定石だけで進めた盤面を作り、その各段階で 2 つのルールを試す
      for (let round = 0; round < 12; round++) {
        for (const rule of rules) {
          const { fills, conflicts } = findMatches(grid, puzzle.clues, state, rule);
          assert.equal(conflicts, 0, `${rule.id}: 正しい盤面で矛盾を報告した`);
          for (const { edge, value } of fills) {
            assert.equal(value, puzzle.solution[edge], `${rule.id} が正解と違う辺を埋めた`);
            filled++;
          }
        }
        let moved = false;
        for (const pattern of templates) {
          const { fills } = findMatches(grid, puzzle.clues, state, pattern);
          for (const { edge, value } of fills) { state[edge] = value; moved = true; }
        }
        if (!moved) break;
      }
    }
  }
  assert.ok(filled > 50, `ルール適用型がほとんど働いていない (${filled} 本)`);
});

test('点の次数ルールは、型では拾えない形も埋める', () => {
  const rule = PATTERNS.find((p) => p.match === 'vertex');
  const grid = getGrid(5, 6);
  const clues = new Int8Array(30).fill(-1);

  const cases = [
    { label: '盤の角: 1 辺が線', marks: [['h', 0, 0, LINE]], want: [grid.v(0, 0), LINE] },
    { label: '盤の角: 1 辺が ×', marks: [['h', 0, 0, CROSS]], want: [grid.v(0, 0), CROSS] },
    { label: '縁: 線 1 + × 1', marks: [['h', 0, 2, LINE], ['v', 0, 3, CROSS]], want: [grid.h(0, 3), LINE] },
    { label: '縁: 線が一直線に 2 本', marks: [['h', 0, 2, LINE], ['h', 0, 3, LINE]], want: [grid.v(0, 3), CROSS] },
    { label: '内側: 線 1 + × 2 でまっすぐ進む', marks: [['h', 2, 1, LINE], ['v', 1, 2, CROSS], ['v', 2, 2, CROSS]], want: [grid.h(2, 2), LINE] },
  ];

  for (const { label, marks, want } of cases) {
    const state = new Int8Array(grid.edgeCount);
    for (const [dir, r, c, v] of marks) state[dir === 'h' ? grid.h(r, c) : grid.v(r, c)] = v;
    const { fills } = findMatches(grid, clues, state, rule);
    const hit = fills.find((f) => f.edge === want[0]);
    assert.ok(hit, `${label}: 埋めてくれない`);
    assert.equal(hit.value, want[1], `${label}: 値が違う`);
  }
});

test('閉空間ルールは、交点の数え上げでは届かない辺を埋める', () => {
  const rule = PATTERNS.find((p) => p.match === 'bridge');
  const vertexRule = PATTERNS.find((p) => p.match === 'vertex');
  const grid = getGrid(3, 3);
  const clues = new Int8Array(9).fill(-1);
  const state = new Int8Array(grid.edgeCount);
  // まん中のマスのまわりだけが残り、外へ出る道が h(1,0) の 1 本だけの形
  for (const [dir, r, c] of [['v',0,1],['h',1,2],['v',0,2],['h',2,0],['v',2,1],['h',2,2],['v',2,2]]) {
    state[dir === 'h' ? grid.h(r, c) : grid.v(r, c)] = CROSS;
  }
  const target = grid.h(1, 0);

  // 総当たりでも × で確定する
  const asLine = Int8Array.from(state);
  asLine[target] = LINE;
  assert.equal(countSolutions(grid, clues, 1, asLine), 0, 'この辺は線にできてしまう');

  // 交点の数え上げでは届かない
  assert.equal(findMatches(grid, clues, state, vertexRule).fills.length, 0);
  // 閉空間ルールなら届く
  const hit = findMatches(grid, clues, state, rule).fills.find((f) => f.edge === target);
  assert.ok(hit && hit.value === CROSS, '閉空間ルールが埋めてくれない');
});

test('盤の端にある 0 にも当てはまる', () => {
  // 定義は 3x3 の枠だが、まわりの余白は推論に使っていない。
  // 枠ごと収まることを求めると端の 0 を取りこぼす（実際に起きた不具合）。
  const grid = getGrid(7, 7);
  const zero = PATTERNS.find((p) => p.id === 'zero');
  const state = new Int8Array(grid.edgeCount);

  const at = (r, c) => {
    const clues = new Int8Array(49).fill(-1);
    clues[r * 7 + c] = 0;
    return findMatches(grid, clues, state, zero);
  };
  assert.equal(at(3, 3).places, 1, '盤の内側の 0');
  assert.equal(at(3, 0).places, 1, '左端の 0');
  assert.equal(at(0, 3).places, 1, '上端の 0');
  assert.equal(at(6, 6).places, 1, '右下の角の 0');
  assert.equal(at(0, 0).fills.length, 4, '角の 0 でも 4 辺すべてを埋める');

  // 端と内側が混ざっていても全部数える
  const clues = new Int8Array(49).fill(-1);
  clues[3 * 7 + 0] = 0;
  clues[4 * 7 + 1] = 0;
  clues[4 * 7 + 2] = 0;
  assert.equal(findMatches(grid, clues, state, zero).places, 3);
});

/**
 * 端にかかる置き方でも結論が本当に確定するかを、総当たりで全部調べる。
 * 余白ごと収まることを求めるのをやめたので、ここは実際に効く検査になる。
 */
test('盤の端にかかる置き方でも結論が確定する', () => {
  const SIZE = 4;
  const grid = getGrid(SIZE, SIZE);
  const edgeOf = (dir, r, c) => (dir === 'h' ? grid.h(r, c) : grid.v(r, c));
  const valueOf = (kind) => (kind === 'line' ? LINE : CROSS);
  let checked = 0;

  for (const pattern of PATTERNS) {
    if (pattern.match || pattern.anchor !== 'interior') continue;
    for (const variant of orientationsOf(pattern)) {
      for (const [dr, dc] of placementsOf(variant, SIZE)) {
        const clues = new Int8Array(SIZE * SIZE).fill(-1);
        for (const [r, c, n] of variant.clues) clues[(r + dr) * SIZE + (c + dc)] = n;
        const given = new Int8Array(grid.edgeCount);
        for (const [dir, r, c, kind] of variant.given) {
          given[edgeOf(dir, r + dr, c + dc)] = valueOf(kind);
        }
        // その置き方自体が成り立たない盤面は、当てはめようがないので飛ばす
        if (countSolutions(grid, clues, 1, given) === 0) continue;

        for (const [dir, r, c, kind] of variant.conclude) {
          const probe = Int8Array.from(given);
          probe[edgeOf(dir, r + dr, c + dc)] = valueOf(kind) === LINE ? CROSS : LINE;
          checked++;
          assert.equal(
            countSolutions(grid, clues, 1, probe), 0,
            `${pattern.id} 向き${variant.transform} 位置(${dr},${dc}) の ${dir}(${r + dr},${c + dc}) が確定しない`,
          );
        }
      }
    }
  }
  assert.ok(checked > 500, `検査した結論が ${checked} 件しかない`);
});

/** テスト側でも置ける位置を出す（pattern-match.js と同じ考え方）。 */
function placementsOf(variant, size) {
  let minDr = -Infinity, maxDr = Infinity, minDc = -Infinity, maxDc = Infinity;
  const clamp = (lowR, highR, lowC, highC) => {
    minDr = Math.max(minDr, lowR);
    maxDr = Math.min(maxDr, highR);
    minDc = Math.max(minDc, lowC);
    maxDc = Math.min(maxDc, highC);
  };
  for (const [r, c] of variant.clues) clamp(-r, size - 1 - r, -c, size - 1 - c);
  for (const [dir, r, c] of [...variant.given, ...variant.conclude]) {
    clamp(-r, (dir === 'h' ? size : size - 1) - r, -c, (dir === 'h' ? size - 1 : size) - c);
  }
  const list = [];
  for (let dr = minDr; dr <= maxDr; dr++) {
    for (let dc = minDc; dc <= maxDc; dc++) list.push([dr, dc]);
  }
  return list;
}

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

test('すべての定石は、その形を盤に作れば見つかる', () => {
  for (const pattern of templates) {
    // 定石が要求する位置関係のまま、少し大きな盤に置いてみる
    const pad = 2;
    const rows = pattern.rows + (pattern.anchor === 'interior' ? pad * 2 : pad);
    const cols = pattern.cols + (pattern.anchor === 'corner' ? pad : pad * 2);
    const dr = pattern.anchor === 'interior' ? pad : 0;
    const dc = pattern.anchor === 'corner' ? 0 : pad;

    const grid = getGrid(rows, cols);
    const clues = new Int8Array(rows * cols).fill(-1);
    for (const [r, c, n] of pattern.clues) clues[(r + dr) * cols + (c + dc)] = n;
    const state = new Int8Array(grid.edgeCount);
    for (const [dir, r, c, kind] of pattern.given) {
      state[dir === 'h' ? grid.h(r + dr, c + dc) : grid.v(r + dr, c + dc)] =
        kind === 'line' ? LINE : CROSS;
    }

    const { fills } = findMatches(grid, clues, state, pattern);
    const filled = new Set(fills.map((f) => f.edge));
    for (const [dir, r, c, kind] of pattern.conclude) {
      const edge = dir === 'h' ? grid.h(r + dr, c + dc) : grid.v(r + dr, c + dc);
      assert.ok(filled.has(edge), `${pattern.id}: 自分の形を置いたのに ${dir}(${r},${c}) を見つけられない`);
      assert.equal(
        fills.find((f) => f.edge === edge).value,
        kind === 'line' ? LINE : CROSS,
        `${pattern.id}: ${dir}(${r},${c}) の値が定義と違う`,
      );
    }
  }
});

test('生成した問題で、半分以上の定石が実際に使われる', () => {
  const used = new Set();
  for (const [rows, cols, difficulty] of [[5, 5, 'easy'], [7, 7, 'easy'], [7, 7, 'normal'], [10, 10, 'normal']]) {
    for (let i = 0; i < 5; i++) {
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
  // 珍しい配置の定石は出番が無いこともあるので、割合で見る
  assert.ok(
    used.size / PATTERNS.length >= 0.7,
    `使われた定石が ${used.size}/${PATTERNS.length} しかない`,
  );
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
