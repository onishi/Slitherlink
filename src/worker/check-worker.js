/** 持ち込まれた問題が論理だけで解けるか・いまの問題の解き味を、画面を止めずに調べるワーカー。 */
import { checkPuzzle, encodePuzzle } from '../core/puzzle.js';
import { difficultyReport } from '../core/difficulty-report.js';

self.onmessage = (ev) => {
  const { id, rows, cols, clues, type } = ev.data || {};
  if (type === 'repair') {
    repair(ev.data);
    return;
  }
  if (type === 'report') {
    try {
      const { solution } = ev.data;
      const report = difficultyReport({
        rows, cols, clues: Int8Array.from(clues), solution: solution ? Int8Array.from(solution) : undefined,
      });
      self.postMessage({ id, type: 'report', report });
    } catch (err) {
      self.postMessage({ id, type: 'report', error: String(err && err.message ? err.message : err) });
    }
    return;
  }
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

/**
 * 読み取りの自信が低いマスを 1 つずつ次に近い数字へ変えてみて、論理だけで解けるようになるものを探す。
 * 見つかれば最初の 1 つを返す（直すかどうかは利用者が決める）。
 */
function repair({ id, rows, cols, clues, candidates }) {
  const started = Date.now();
  for (const [cell, to] of candidates) {
    if (Date.now() - started > 8000) break;
    const next = Int8Array.from(clues);
    next[cell] = to;
    try {
      if (checkPuzzle({ rows, cols, clues: next }).status === 'ok') {
        self.postMessage({ id, type: 'repair', found: { cell, from: clues[cell], to } });
        return;
      }
    } catch {
      // 確かめられなかった候補は飛ばす
    }
  }
  self.postMessage({ id, type: 'repair', found: null });
}
