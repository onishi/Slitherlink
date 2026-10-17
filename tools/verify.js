/**
 * 大量に作問して「必ず論理だけで解ける・解が一意・解き味が難易度どおり」を実地で確かめる。
 * 論理で解けるかは、ソルバとは別に「検算に通る証明つきの手だけで正解まで届くか」でも確かめる
 * （正解は使わず、両方の値を仮定して試す）。
 *   node tools/verify.js [繰り返し数] [--random]
 * 乱数の種は、大きさ・難易度・何回目かから決める（毎回同じ問題を確かめる。CI がたまたまの作り損ないで落ちないように）。
 * --random を付けると、毎回ちがう種で確かめる（作問器を変えたときに、手元で広く試す）。
 */
import { getGrid, isSingleLoop, cluesFromEdges, LINE } from '../src/core/grid.js';
import { solveLogical, countSolutions } from '../src/core/solver.js';
import { generatePuzzle, DIFFICULTIES } from '../src/core/generator.js';
import { solveWithProofs } from '../src/core/proof.js';
import { difficultyReport, levelOf } from '../src/core/difficulty-report.js';

const args = process.argv.slice(2);
const random = args.includes('--random');
const reps = Number(args.find((a) => !a.startsWith('--')) || 3);
/** 大きさ・難易度・何回目かから決まる種。 */
const seedOf = (rows, cols, difficulty, i) => {
  let h = 2166136261;
  for (const ch of `${rows}x${cols}:${difficulty}:${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
};
const sizes = [[5, 5], [6, 8], [7, 7], [10, 10]];
let total = 0;
let bad = 0;

for (const [rows, cols] of sizes) {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    for (let i = 0; i < reps; i++) {
      const started = Date.now();
      const seed = random ? Math.floor(Math.random() * 0xffffffff) >>> 0 : seedOf(rows, cols, difficulty, i);
      // 時間切れで結果が変わらないよう、制限時間はたっぷり取る（同じ種なら、遅い機械でも同じ問題になる）
      const p = generatePuzzle({ rows, cols, difficulty, seed, timeLimitMs: 120000 });
      const g = getGrid(rows, cols);
      const issues = [];
      total++;

      const loop = new Uint8Array(g.edgeCount);
      for (let e = 0; e < g.edgeCount; e++) loop[e] = p.solution[e] === LINE ? 1 : 0;
      if (!isSingleLoop(g, loop)) issues.push('正解が単一ループでない');

      const full = cluesFromEdges(g, loop);
      for (let cell = 0; cell < g.cellCount; cell++) {
        if (p.clues[cell] >= 0 && p.clues[cell] !== full[cell]) { issues.push('数字が正解と不一致'); break; }
      }

      const res = solveLogical(g, p.clues, { maxDepth: DIFFICULTIES[difficulty].depth });
      if (res.status !== 'solved') issues.push(`論理だけで解けない (${res.status})`);
      else {
        for (let e = 0; e < g.edgeCount; e++) {
          if (res.state.edges[e] !== p.solution[e]) { issues.push('論理解が正解と違う'); break; }
        }
      }
      if (countSolutions(g, p.clues, 2) !== 1) issues.push('解が一意でない');

      const proved = solveWithProofs(g, p.clues, { maxDepth: DIFFICULTIES[difficulty].depth - 1 });
      if (!proved.solved) issues.push('証明つきの手だけでは解き切れない');
      else if (proved.edges.some((v, e) => v !== p.solution[e])) issues.push('証明でたどった答えが正解と違う');

      if (p.difficulty !== difficulty) issues.push(`狙いの難易度が作れなかった (${p.difficulty})`);
      const level = levelOf(difficultyReport(p));
      if (level !== p.difficulty) issues.push(`解き味（${level}）が付けた難易度と違う`);

      const tag = `${rows}x${cols} ${DIFFICULTIES[difficulty].label}`;
      if (issues.length) {
        bad++;
        console.log(`NG  ${tag}（種 ${seed}）: ${issues.join(' / ')}`);
      } else {
        console.log(`ok  ${tag}  数字 ${p.clueCount}/${rows * cols}  ${Date.now() - started}ms`);
      }
    }
  }
}

console.log(`\n${total} 問を検証、問題のあったもの ${bad} 問`);
process.exit(bad === 0 ? 0 : 1);
