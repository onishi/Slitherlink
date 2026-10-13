import test from 'node:test';
import assert from 'node:assert/strict';
import { LINE, CROSS } from '../src/core/grid.js';
import { countSolutions, solveLogical } from '../src/core/solver.js';
import { PATTERNS, CATEGORIES, buildPattern, padded, expandForms, isSearchPattern } from '../src/core/patterns.js';

// alt を持つ定石は、別の形もそれぞれ 1 つの定石として確かめる
const FORMS = PATTERNS.flatMap(expandForms);
import { PATTERN_USAGE } from '../src/core/pattern-stats.js';
import { applyAllPatterns, findMatches } from '../src/core/pattern-match.js';
import { UNKNOWN } from '../src/core/grid.js';

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
  for (const pattern of FORMS) {
    const { grid, clues, given } = buildPattern(pattern);
    assert.ok(
      countSolutions(grid, clues, 1, given) > 0,
      `${pattern.id}: 前提に解が無い。これでは何でも「確定」になってしまう`,
    );
  }
});

for (const pattern of FORMS) {
  const label = pattern.id.includes('#') ? `${pattern.title}（別の形）` : pattern.title;
  test(`定石「${label}」の結論が本当に確定する`, () => {
    assert.ok(pattern.conclude.length > 0, `${pattern.id}: 結論が空`);
    const { conclude } = buildPattern(pattern);
    conclude.forEach((conclusion, i) => {
      assert.ok(
        isForced(pattern, conclusion),
        `${pattern.id}: ${JSON.stringify(pattern.conclude[i])} は確定しない（反例あり）`,
      );
    });
  });

  if (pattern.anchor === 'interior') {
    // 余白付きの大きな盤は総当たりが重いので、論理ソルバで矛盾を示す。
    // 「矛盾する」と言えた時点で解が無いことは確定なので、証明として十分。
    test(`定石「${label}」は盤の端と関係なく成り立つ`, () => {
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

test('縁の定石は、盤の縁に置いても成り立つ', () => {
  for (const pattern of PATTERNS) {
    if (pattern.anchor !== 'border') continue;
    // 縁に付けたまま、より大きな盤でも同じ結論になるか
    const wide = {
      ...pattern,
      rows: pattern.rows + 3,
      cols: pattern.cols + 4,
      clues: pattern.clues.map(([r, c, n]) => [r, c + 2, n]),
      given: pattern.given.map(([d, r, c, k]) => [d, r, c + 2, k]),
      conclude: pattern.conclude.map(([d, r, c, k]) => [d, r, c + 2, k]),
    };
    const { grid, clues, given, conclude } = buildPattern(wide);
    assert.ok(countSolutions(grid, clues, 1, given) > 0, `${pattern.id}: 広い盤で前提に解が無い`);
    conclude.forEach((conclusion, i) => {
      assert.equal(
        countSolutions(grid, clues, 1, probeState(given, conclusion)), 0,
        `${pattern.id}: 広い盤の縁では ${JSON.stringify(pattern.conclude[i])} が確定しない`,
      );
    });
  }
});

test('定石は定番を先に、あとは出番の多い順に並んでいる', () => {
  for (const p of PATTERNS) {
    assert.ok(typeof p.level === 'number' && p.level >= 1 && p.level <= 5, `${p.id}: level が無い`);
    assert.ok(p.id in PATTERN_USAGE, `${p.id}: 出番の実測値が無い（node tools/pattern-stats.js を走らせる）`);
  }
  for (const id of Object.keys(PATTERN_USAGE)) {
    assert.ok(PATTERNS.some((p) => p.id === id), `${id}: もう無い定石の実測値が残っている`);
  }
  for (let i = 1; i < PATTERNS.length; i++) {
    const [a, b] = [PATTERNS[i - 1], PATTERNS[i]];
    if (a.popular || b.popular) {
      // 定番は先頭に、覚えたい順で
      assert.ok(a.popular && (!b.popular || a.popular < b.popular), `定番の ${b.id} が ${a.id} より前に来るべき`);
      continue;
    }
    assert.ok(a.usage > b.usage || (a.usage === b.usage && a.level <= b.level), `${b.id} が ${a.id} より前に来るべき`);
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

test('ヒントから足した定石は、ほかの定石をどう組み合わせても届かない', () => {
  const added = PATTERNS.filter((p) => p.origin === 'hint');
  assert.ok(added.length >= 6);
  for (const pattern of added) {
    const others = PATTERNS.filter((p) => p !== pattern && !isSearchPattern(p));
    const { grid, clues, given, conclude } = buildPattern(padded(pattern, 2));
    const after = applyAllPatterns(grid, clues, given, others);
    assert.ok(
      conclude.some(({ edge }) => after[edge] === UNKNOWN),
      `${pattern.id}: ほかの定石だけで結論がすべて出てしまう（載せる意味が無い）`,
    );
  }
});

test('近道の定石は、書いてある組み合わせだけで同じ結論に届く（論理的に同じものは載せない）', () => {
  const byId = new Map(PATTERNS.map((p) => [p.id, p]));
  for (const pattern of PATTERNS) {
    const boardOf = (f) => buildPattern(f.anchor === 'interior' ? padded(f, 2) : f);
    if (pattern.combines) {
      const parts = pattern.combines.map((id) => {
        assert.ok(byId.has(id), `${pattern.id}: 組み合わせの ${id} が無い`);
        return byId.get(id);
      });
      for (const form of expandForms(pattern)) {
        const { grid, clues, given, conclude } = boardOf(form);
        const after = applyAllPatterns(grid, clues, given, parts);
        assert.ok(conclude.every((c) => after[c.edge] === c.value), `${pattern.id}: ${pattern.combines.join(' + ')} だけでは届かない`);
      }
    }
    // ほかの定石 1 つだけで結論が全部出てしまうなら、それは同じ定石の特別な場合。
    // 定番（popular）はよく知られた形なので、重なっていても載せてよい
    if (pattern.match || pattern.popular) continue;
    for (const form of expandForms(pattern)) {
      const { grid, clues, given, conclude } = boardOf(form);
      for (const other of PATTERNS) {
        if (other === pattern || other.popular || isSearchPattern(other)) continue;
        const { fills } = findMatches(grid, clues, given, other);
        const all = conclude.every((c) => fills.some((f) => f.edge === c.edge && f.value === c.value));
        assert.ok(!all, `${pattern.id} は ${other.id} 1 つで結論が全部出る（同じ定石）`);
      }
    }
  }
});
