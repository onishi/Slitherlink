/**
 * 大量に作問して「必ず論理だけで解ける・解が一意」を実地で確かめる。
 * 論理で解けるかは、ソルバとは別に「検算に通る証明つきの手だけで正解まで届くか」でも確かめる
 * （正解は使わず、両方の値を仮定して試す）。
 *   node tools/verify.js [繰り返し数]
 */
import { getGrid, isSingleLoop, cluesFromEdges, LINE } from '../src/core/grid.js';
import { solveLogical, countSolutions } from '../src/core/solver.js';
import { generatePuzzle, DIFFICULTIES } from '../src/core/generator.js';
import { solveWithProofs } from '../src/core/proof.js';

const reps = Number(process.argv[2] || 3);
const sizes = [[5, 5], [6, 8], [7, 7], [10, 10]];
let total = 0;
let bad = 0;

for (const [rows, cols] of sizes) {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    for (let i = 0; i < reps; i++) {
      const started = Date.now();
      const p = generatePuzzle({ rows, cols, difficulty });
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

      const tag = `${rows}x${cols} ${DIFFICULTIES[difficulty].label}`;
      if (issues.length) {
        bad++;
        console.log(`NG  ${tag}: ${issues.join(' / ')}`);
      } else {
        console.log(`ok  ${tag}  数字 ${p.clueCount}/${rows * cols}  ${Date.now() - started}ms`);
      }
    }
  }
}

console.log(`\n${total} 問を検証、問題のあったもの ${bad} 問`);
process.exit(bad === 0 ? 0 : 1);
