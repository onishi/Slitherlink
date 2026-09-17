/**
 * 作問の手配役。
 * ワーカー 2 本 (要求用 / 先読み用) を使い、次の問題を裏で用意しておく。
 */

import { generatePuzzle } from '../core/generator.js';
import { encodePuzzle } from '../core/puzzle.js';

const WORKER_URL = new URL('../worker/generate-worker.js', import.meta.url);

function spawn() {
  try {
    return new Worker(WORKER_URL, { type: 'module' });
  } catch (err) {
    console.warn('ワーカーを起動できないため、メインスレッドで作問します', err);
    return null;
  }
}

export class PuzzleService {
  constructor() {
    this.cache = new Map();
    this.main = spawn();
    this.prefetcher = this.main ? spawn() : null;
    this.seq = 0;
    this.pending = new Map();
    this.prefetching = new Set();
    for (const w of [this.main, this.prefetcher]) {
      if (!w) continue;
      w.onmessage = (ev) => {
        const entry = this.pending.get(ev.data.id);
        if (!entry) return;
        this.pending.delete(ev.data.id);
        if (ev.data.ok) entry.resolve(materialize(ev.data.puzzle));
        else entry.reject(new Error(ev.data.error));
      };
      w.onerror = (ev) => {
        for (const [id, entry] of this.pending) {
          this.pending.delete(id);
          entry.reject(new Error('作問中にエラーが発生しました'));
        }
        console.error('generator worker error', ev.message || ev);
      };
    }
  }

  static key(rows, cols, difficulty) {
    return `${rows}x${cols}:${difficulty}`;
  }

  /** 先読み済みがあれば即座に、無ければ作ってから返す。 */
  async get(rows, cols, difficulty) {
    const key = PuzzleService.key(rows, cols, difficulty);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.prefetch(rows, cols, difficulty);
      return cached;
    }
    const puzzle = await this._request(this.main, rows, cols, difficulty);
    this.prefetch(rows, cols, difficulty);
    return puzzle;
  }

  /** 同じ設定の次の 1 問を裏で用意しておく。 */
  prefetch(rows, cols, difficulty) {
    const key = PuzzleService.key(rows, cols, difficulty);
    if (this.cache.has(key) || this.prefetching.has(key) || !this.prefetcher) return;
    this.prefetching.add(key);
    this._request(this.prefetcher, rows, cols, difficulty)
      .then((p) => { this.cache.set(key, p); })
      .catch(() => {})
      .finally(() => { this.prefetching.delete(key); });
  }

  _request(worker, rows, cols, difficulty) {
    const seed = (Math.floor(Math.random() * 0xffffffff) >>> 0);
    if (!worker) {
      // ワーカーが使えない環境ではその場で作る
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            const p = generatePuzzle({ rows, cols, difficulty, seed, timeLimitMs: 12000 });
            resolve(materialize({
              rows: p.rows, cols: p.cols, difficulty: p.difficulty,
              clues: Array.from(p.clues), solution: Array.from(p.solution),
              clueCount: p.clueCount, code: encodePuzzle(p),
            }));
          } catch (err) { reject(err); }
        }, 16);
      });
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, rows, cols, difficulty, seed, timeLimitMs: 12000 });
    });
  }
}

function materialize(p) {
  return {
    rows: p.rows,
    cols: p.cols,
    difficulty: p.difficulty,
    clues: Int8Array.from(p.clues),
    solution: Int8Array.from(p.solution),
    clueCount: p.clueCount,
    code: p.code,
  };
}
