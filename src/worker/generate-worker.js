/** 作問をバックグラウンドで行うワーカー。UI をブロックしないためのもの。 */
import { generatePuzzle } from '../core/generator.js';
import { encodePuzzle } from '../core/puzzle.js';
import { difficultyReport, problemStats } from '../core/difficulty-report.js';

self.onmessage = (ev) => {
  const { id, rows, cols, difficulty, seed, timeLimitMs, withStats, style } = ev.data || {};
  try {
    const p = generatePuzzle({ rows, cols, difficulty, seed, timeLimitMs, style });
    self.postMessage({
      id,
      ok: true,
      puzzle: {
        rows: p.rows,
        cols: p.cols,
        difficulty: p.difficulty,
        clues: Array.from(p.clues),
        solution: Array.from(p.solution),
        clueCount: p.clueCount,
        code: encodePuzzle(p),
        style: p.style,
        styleOk: p.styleOk,
        // 管理画面で問題集に入れるときは、難易度のほかの目安も付ける
        stats: withStats ? problemStats(difficultyReport(p), p.solution, p) : undefined,
      },
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
