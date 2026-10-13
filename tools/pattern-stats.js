/**
 * 定石の「出番の多さ」を実測して src/core/pattern-stats.js に書き出す（開発用）。
 *   node tools/pattern-stats.js [1 条件あたりの問題数]
 *
 * 作問した問題をヒントどおりに最初から最後まで解き進め、途中の盤面ごとに
 * 「その定石で埋められる辺」を集める。1 問のあいだに一度でもその定石で埋められた
 * 辺を数え、問題数で割ったものが出番（1 問あたり何本の辺を決める場面があるか）。
 * 盤面ごとに数えると、すぐ使われてしまう易しい定石ほど少なく見えるので、こう数える。
 * 定石一覧はこの値の大きい順に並ぶ。seed は固定なので、何度走らせても同じ値になる。
 */
import { writeFileSync } from 'node:fs';
import { getGrid } from '../src/core/grid.js';
import { generatePuzzle } from '../src/core/generator.js';
import { findHint, analyze } from '../src/core/game.js';
import { PATTERNS } from '../src/core/patterns.js';
import { findMatches } from '../src/core/pattern-match.js';

const reps = Number(process.argv[2] || 4);
const SETS = [];
for (const size of [7, 10]) for (const difficulty of ['easy', 'normal', 'hard']) SETS.push([size, difficulty]);

const usable = new Map(PATTERNS.map((p) => [p.id, 0]));
let states = 0;
let puzzles = 0;

for (const [size, difficulty] of SETS) {
  for (let i = 0; i < reps; i++) {
    const p = generatePuzzle({ rows: size, cols: size, difficulty, seed: 7000 + i * 131 + size });
    const grid = getGrid(size, size);
    const state = new Int8Array(grid.edgeCount);
    puzzles++;
    const seen = new Map(PATTERNS.map((pattern) => [pattern.id, new Set()]));
    for (let step = 0; step < grid.edgeCount; step++) {
      if (analyze(grid, p.clues, state).solved) break;
      states++;
      for (const pattern of PATTERNS) {
        for (const { edge } of findMatches(grid, p.clues, state, pattern).fills) seen.get(pattern.id).add(edge);
      }
      const hint = findHint(grid, p.clues, state, p.solution);
      if (hint.type !== 'move') break;
      state[hint.edge] = hint.value;
    }
    for (const [id, edges] of seen) usable.set(id, usable.get(id) + edges.size);
  }
}

const rows = PATTERNS.map((p) => [p.id, Math.round((usable.get(p.id) / puzzles) * 10) / 10]);
rows.sort((a, b) => b[1] - a[1]);
const body = rows.map(([id, share]) => `  '${id}': ${share},`).join('\n');
writeFileSync(new URL('../src/core/pattern-stats.js', import.meta.url), `/**
 * 定石の出番の多さ（tools/pattern-stats.js が実測して書き出す。手で直さない）。
 * 値は、問題を最初から最後まで解くあいだに、その定石で決められた辺の数（1 問あたりの平均）。
 * 測定: ${puzzles} 問（7×7・10×10 × やさしい・ふつう・むずかしい）、盤面 ${states} 通り。
 */
export const PATTERN_USAGE = {
${body}
};
`);
for (const [id, share] of rows) console.log(`${share.toFixed(1).padStart(6)} 本  ${id}`);
