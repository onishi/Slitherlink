/** 持ち込まれた問題が論理だけで解けるかを、画面を止めずに確かめるワーカー。 */
import { checkPuzzle, encodePuzzle } from '../core/puzzle.js';

self.onmessage = (ev) => {
  const { id, rows, cols, clues } = ev.data || {};
  try {
    const puzzle = { rows, cols, difficulty: 'normal', clues: Int8Array.from(clues) };
    const result = checkPuzzle(puzzle);
    const difficulty = result.difficulty ?? 'normal';
    self.postMessage({
      id,
      ok: true,
      status: result.status,
      difficulty,
      clueCount: result.clueCount,
      solution: result.solution ? Array.from(result.solution) : null,
      code: encodePuzzle({ ...puzzle, difficulty }),
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
