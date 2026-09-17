/** 作問をバックグラウンドで行うワーカー。UI をブロックしないためのもの。 */
import { generatePuzzle } from '../core/generator.js';
import { encodePuzzle } from '../core/puzzle.js';

self.onmessage = (ev) => {
  const { id, rows, cols, difficulty, seed, timeLimitMs } = ev.data || {};
  try {
    const p = generatePuzzle({ rows, cols, difficulty, seed, timeLimitMs });
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
      },
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
