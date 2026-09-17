/**
 * 作問器。
 *
 * 1. ランダムな「内側マスの集合」を育てて、その境界を 1 本の輪にする
 * 2. 輪からすべてのマスの数字を求める
 * 3. 数字をランダムな順に消し、消すたびに論理ソルバで解き直す。
 *    解けなくなる数字だけ残す → 「必ずロジカルに解ける」問題になる。
 */

import { getGrid, boundaryEdges, isSingleLoop, cluesFromEdges, LINE } from './grid.js';
import { solveLogical } from './solver.js';

/** xorshift32 による決定的な乱数生成器。 */
export function makeRng(seed) {
  let x = (seed | 0) || 0x9e3779b9;
  return function rng() {
    x ^= x << 13; x |= 0;
    x ^= x >>> 17;
    x ^= x << 5; x |= 0;
    return ((x >>> 0) / 4294967296);
  };
}

export const DIFFICULTIES = {
  easy:   { label: 'やさしい', depth: 0, minDepth: 0, passes: 1 },
  normal: { label: 'ふつう',   depth: 1, minDepth: 0, passes: 1 },
  hard:   { label: 'むずかしい', depth: 2, minDepth: 1, passes: 1 },
};

/**
 * 1 本の輪をランダムに作る。
 * 内側集合にマスを足し引きして、境界が常に単一ループであることを保てる変更だけ採用する。
 */
export function randomLoop(rows, cols, rng) {
  const grid = getGrid(rows, cols);
  const inside = new Uint8Array(rows * cols);
  // 中央の 1 マスから開始
  inside[Math.floor(rows / 2) * cols + Math.floor(cols / 2)] = 1;

  const targetCells = Math.max(2, Math.round(rows * cols * (0.3 + rng() * 0.3)));
  const steps = rows * cols * 60;
  let count = 1;

  for (let i = 0; i < steps; i++) {
    const r = Math.floor(rng() * rows);
    const c = Math.floor(rng() * cols);
    const idx = r * cols + c;
    const adding = inside[idx] === 0;
    // 目標サイズに近づく方向を優先する
    if (adding && count >= targetCells && rng() < 0.75) continue;
    if (!adding && count <= targetCells * 0.6 && rng() < 0.75) continue;

    inside[idx] = adding ? 1 : 0;
    const next = count + (adding ? 1 : -1);
    if (next <= 0 || !validRegion(grid, inside)) {
      inside[idx] = adding ? 0 : 1;
      continue;
    }
    count = next;
  }
  const edges = boundaryEdges(grid, inside);
  if (!isSingleLoop(grid, edges)) return null;
  return { grid, inside, edges };
}

/** 内側集合の境界がちょうど 1 本の輪になっているか。 */
function validRegion(grid, inside) {
  const edges = boundaryEdges(grid, inside);
  return isSingleLoop(grid, edges);
}

/**
 * 問題を 1 問作る。
 * @param {object} options
 * @param {number} options.rows
 * @param {number} options.cols
 * @param {'easy'|'normal'|'hard'} [options.difficulty]
 * @param {number} [options.seed]
 * @returns {{rows:number, cols:number, difficulty:string, clues:Int8Array, solution:Int8Array, seed:number, clueCount:number}}
 */
export function generatePuzzle(options = {}) {
  const rows = options.rows ?? 7;
  const cols = options.cols ?? 7;
  const difficultyKey = options.difficulty ?? 'normal';
  const conf = DIFFICULTIES[difficultyKey] ?? DIFFICULTIES.normal;
  let seed = options.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
  const deadline = options.deadline ?? (Date.now() + (options.timeLimitMs ?? 20000));

  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = makeRng((seed + attempt * 0x9e3779b1) >>> 0);
    const loop = randomLoop(rows, cols, rng);
    if (!loop) continue;
    const { grid, edges } = loop;

    const solution = new Int8Array(grid.edgeCount);
    for (let e = 0; e < grid.edgeCount; e++) solution[e] = edges[e] === 1 ? 1 : 2;

    const clues = cluesFromEdges(grid, edges);
    // 全数字があれば必ず解ける (念のため確認)
    if (solveLogical(grid, clues, { maxDepth: 0 }).status !== 'solved') continue;

    // 安い推論で削れるだけ削ってから、必要なら深い推論で追い込む (2 段階)。
    const phases = [];
    for (let d = Math.min(conf.depth, 1); d <= conf.depth; d++) phases.push(d);
    for (const depth of phases) {
      for (let pass = 0; pass < conf.passes; pass++) {
        const seq = shuffled(grid.cellCount, rng);
        let removed = 0;
        for (const cell of seq) {
          if (clues[cell] < 0) continue;
          if (Date.now() > deadline) break;
          const saved = clues[cell];
          clues[cell] = -1;
          const res = solveLogical(grid, clues, { maxDepth: depth, budget: depth >= 2 ? 40000 : 200000 });
          if (res.status !== 'solved') clues[cell] = saved;
          else removed++;
        }
        if (removed === 0 || Date.now() > deadline) break;
      }
      if (Date.now() > deadline) break;
    }

    // 難易度の下限チェック: 「むずかしい」は簡単な推論だけでは解けないこと
    if (conf.minDepth > 0) {
      const easyTry = solveLogical(grid, clues, { maxDepth: conf.minDepth - 1 });
      if (easyTry.status === 'solved' && attempt < 12 && Date.now() < deadline) continue;
    }

    let clueCount = 0;
    for (let i = 0; i < clues.length; i++) if (clues[i] >= 0) clueCount++;

    return {
      rows,
      cols,
      difficulty: difficultyKey,
      clues,
      solution,
      seed: (seed + attempt * 0x9e3779b1) >>> 0,
      clueCount,
    };
  }
  throw new Error('問題の生成に失敗しました');
}

function shuffled(n, rng) {
  const a = new Int32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
