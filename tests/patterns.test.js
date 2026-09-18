import test from 'node:test';
import assert from 'node:assert/strict';
import { LINE, CROSS } from '../src/core/grid.js';
import { countSolutions, solveLogical } from '../src/core/solver.js';
import { PATTERNS, CATEGORIES, buildPattern, padded } from '../src/core/patterns.js';

const flip = (value) => (value === LINE ? CROSS : LINE);

function probeState(given, { edge, value }) {
  const probe = Int8Array.from(given);
  probe[edge] = flip(value);
  return probe;
}

/**
 * 結論の辺を逆の値にした盤面に解が 1 つも無ければ、その結論は確定している。
 * ソルバの推論ルールに頼らず総当たりで確かめるので、定石が本当かどうかの
 * 判定そのものになる。
 */
function isForced(pattern, conclusion) {
  const { grid, clues, given } = buildPattern(pattern);
  return countSolutions(grid, clues, 1, probeState(given, conclusion)) === 0;
}

test('定石の前提そのものに解がある（空虚な真になっていない）', () => {
  for (const pattern of PATTERNS) {
    const { grid, clues, given } = buildPattern(pattern);
    assert.ok(
      countSolutions(grid, clues, 1, given) > 0,
      `${pattern.id}: 前提に解が無い。これでは何でも「確定」になってしまう`,
    );
  }
});

for (const pattern of PATTERNS) {
  test(`定石「${pattern.title}」の結論が本当に確定する`, () => {
    assert.ok(pattern.conclude.length > 0, `${pattern.id}: 結論が空`);
    const { conclude } = buildPattern(pattern);
    conclude.forEach((conclusion, i) => {
      assert.ok(
        isForced(pattern, conclusion),
        `${pattern.id}: ${JSON.stringify(pattern.conclude[i])} は確定しない（反例あり）`,
      );
    });
  });

  if (pattern.interior) {
    // 余白付きの大きな盤は総当たりが重いので、論理ソルバで矛盾を示す。
    // 「矛盾する」と言えた時点で解が無いことは確定なので、証明として十分。
    test(`定石「${pattern.title}」は盤の端と関係なく成り立つ`, () => {
      const { grid, clues, given, conclude } = buildPattern(padded(pattern, 2));
      assert.notEqual(
        solveLogical(grid, clues, { maxDepth: 0, initial: given }).status,
        'contradiction',
        `${pattern.id}: 余白付き盤で前提そのものが矛盾している`,
      );
      conclude.forEach((conclusion, i) => {
        const res = solveLogical(grid, clues, {
          maxDepth: 2,
          initial: probeState(given, conclusion),
        });
        assert.equal(
          res.status, 'contradiction',
          `${pattern.id}: 余白付きの盤では ${JSON.stringify(pattern.conclude[i])} を否定しても矛盾が示せない`,
        );
      });
    });
  }
}

test('すべての定石に説明文と正しい分類がある', () => {
  const ids = new Set(CATEGORIES.map((c) => c.id));
  const seen = new Set();
  for (const p of PATTERNS) {
    assert.ok(ids.has(p.category), `${p.id}: 知らない分類 ${p.category}`);
    assert.ok(p.why && p.why.length > 20, `${p.id}: 説明文が短すぎる`);
    assert.ok(!seen.has(p.id), `${p.id}: id が重複している`);
    seen.add(p.id);
  }
});

test('すべての分類に定石が 1 つ以上ある', () => {
  for (const c of CATEGORIES) {
    assert.ok(
      PATTERNS.some((p) => p.category === c.id),
      `分類 ${c.id} に定石が無い`,
    );
  }
});
