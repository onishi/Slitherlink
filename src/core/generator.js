/**
 * 作問器。
 *
 * 1. ランダムな「内側マスの集合」を育てて、その境界を 1 本の輪にする
 * 2. 輪からすべてのマスの数字を求める
 * 3. 数字をランダムな順に消し、消すたびに論理ソルバで解き直す。
 *    解けなくなる数字だけ残す → 「必ずロジカルに解ける」問題になる。
 * 4. 仕上げに、空の盤面から「検算に通る証明つきの手」だけを積み重ねて
 *    正解まで届くかを確かめる。ヒントが最後まで根拠を示せることの保証でもある。
 */

import { getGrid, boundaryEdges, isSingleLoop, cluesFromEdges, LINE } from './grid.js';
import { solveLogical } from './solver.js';
import { solveWithProofs } from './proof.js';
import { difficultyReport, levelOf, LEVELS, problemStats } from './difficulty-report.js';
import { nikoliCheck } from './nikoli.js';

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

/**
 * 難易度。解き味（difficulty-report.js の分析で、どの段の考え方まで要るか）で決める。
 * depth は数字を削るときに使うソルバの背理法の深さ（その難易度に届くのに要る深さ）。
 */
export const DIFFICULTIES = {
  intro:  { label: '入門',     depth: 0, about: '定石を当てはめるだけで解けます' },
  easy:   { label: 'やさしい', depth: 0, about: '定石に加えて、基本ルールの組み合わせを使います' },
  normal: { label: 'ふつう',   depth: 1, about: '数字のまわりをまとめて考える「読みの定石」が要ります（仮定は要りません）' },
  hard:   { label: 'むずかしい', depth: 1, about: '1 か所を仮定して矛盾を見る、1 段の読みが要ります' },
  expert: { label: '鬼',       depth: 2, about: '仮定の中でさらに仮定する、2 段の読みが要ります' },
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

/**
 * 輪を盤いっぱいにくねらせる（ニコリ風）。randomLoop で作った輪から、マスを足し引きして輪が短くならない変更だけを
 * 採り、輪の長さがマス数の 0.85〜0.97 倍になったら止める（ニコリの問題はだいたい 0.9 前後）。
 * 内側のマスは盤の 35〜65% に保つ。
 */
export function stretchLoop(loop, rng) {
  const { grid, inside } = loop;
  const { rows, cols } = grid;
  const insideAt = (r, c) => (r >= 0 && r < rows && c >= 0 && c < cols && inside[r * cols + c] === 1 ? 1 : 0);
  let count = 0;
  for (let i = 0; i < inside.length; i++) count += inside[i];
  let len = 0;
  const edges0 = boundaryEdges(grid, inside);
  for (let e = 0; e < edges0.length; e++) len += edges0[e];
  const target = rows * cols * (0.85 + rng() * 0.12);
  const lo = rows * cols * 0.35;
  const hi = rows * cols * 0.65;
  for (let i = 0; i < rows * cols * 20 && len < target; i++) {
    const r = Math.floor(rng() * rows);
    const c = Math.floor(rng() * cols);
    const idx = r * cols + c;
    const k = insideAt(r - 1, c) + insideAt(r + 1, c) + insideAt(r, c - 1) + insideAt(r, c + 1);
    const adding = inside[idx] === 0;
    // 足すと境界は 4 - 2k 本、引くと 2k - 4 本だけ変わる（k は内側の隣の数）
    const delta = adding ? 4 - 2 * k : 2 * k - 4;
    if (delta < 0) continue;
    if (adding ? count + 1 > hi : count - 1 < lo) continue;
    inside[idx] = adding ? 1 : 0;
    if (!validRegion(grid, inside)) { inside[idx] = adding ? 0 : 1; continue; }
    count += adding ? 1 : -1;
    len += delta;
  }
  return { grid, inside, edges: boundaryEdges(grid, inside) };
}

/** 内側集合の境界がちょうど 1 本の輪になっているか。 */
function validRegion(grid, inside) {
  const edges = boundaryEdges(grid, inside);
  return isSingleLoop(grid, edges);
}

/**
 * 問題を 1 問作る。
 * 1. 輪を作り、全部の数字から始めて、ソルバ（背理法の深さ depth まで）で解ける限り数字を削る。
 *    削った順番を覚えておく
 * 2. できた問題を解き味の分析にかけ、難易度（どの段の考え方まで要るか）を決める
 * 3. 狙いより難しければ、削った順番の途中まで戻す（数字を足し戻す）。途中のどこで狙いの難易度に
 *    なるかは、二分探索で探す。数字が多いほど難しくはならないので、たいてい狙いどおりの所が見つかる
 * 4. 狙いより易しい、または狙いの段が飛ばされたら、輪から作り直す
 * 時間切れのときは、それまでに作れたうちで狙いにいちばん近い問題を、本当の難易度を付けて返す。
 * @param {object} options
 * @param {number} options.rows
 * @param {number} options.cols
 * @param {'intro'|'easy'|'normal'|'hard'|'expert'} [options.difficulty]
 * @param {'nikoli'} [options.style] 'nikoli' なら、輪を盤いっぱいにくねらせ、数字を点対称の組で削り、
 *   ニコリ風の条件（src/core/nikoli.js）を満たすものだけを合格にする
 * @param {number} [options.seed]
 * @returns {{rows:number, cols:number, difficulty:string, clues:Int8Array, solution:Int8Array, seed:number, clueCount:number}}
 */
export function generatePuzzle(options = {}) {
  const rows = options.rows ?? 7;
  const cols = options.cols ?? 7;
  const target = DIFFICULTIES[options.difficulty] ? options.difficulty : 'normal';
  const conf = DIFFICULTIES[target];
  const rank = LEVELS.indexOf(target);
  const seed = options.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
  const deadline = options.deadline ?? (Date.now() + (options.timeLimitMs ?? 20000));
  const nikoli = options.style === 'nikoli';
  let best = null; // 時間切れのときに返す、狙いにいちばん近いもの
  let bestScore = Infinity;

  for (let attempt = 0; attempt < 200; attempt++) {
    const attemptSeed = (seed + attempt * 0x9e3779b1) >>> 0;
    const rng = makeRng(attemptSeed);
    let loop = randomLoop(rows, cols, rng);
    if (!loop) continue;
    if (nikoli) loop = stretchLoop(loop, rng);
    const { grid, edges } = loop;

    const solution = new Int8Array(grid.edgeCount);
    for (let e = 0; e < grid.edgeCount; e++) solution[e] = edges[e] === 1 ? 1 : 2;
    // ニコリ風は、輪の形（線の長さ・行き渡り・最大の空き地）が条件に合わなければ数字を削る前に作り直す
    if (nikoli) {
      const shape = problemStats({ decided: { plain: 0, search: 0 }, total: 1, beforeAssume: 1, assumeCount: 0, longest: 0 }, solution, { rows, cols });
      const check = nikoliCheck({ rows, cols, clueCount: 0, ...shape, patternShare: null, assumeCount: null });
      if (check.ok === false) continue;
    }

    const full = cluesFromEdges(grid, edges);
    // 全数字があれば必ず解ける (念のため確認)
    if (solveLogical(grid, full, { maxDepth: 0 }).status !== 'solved') continue;

    const levelAt = (c) => LEVELS.indexOf(levelOf(difficultyReport({ rows, cols, clues: c, solution })));

    // 1. 削る。安い推論で削れるだけ削ってから、必要なら深い推論で追い込む。
    //    深い推論（2 段）で削るのは重いので、狙いの難易度に届いたらそこで止める
    //    ニコリ風は、点対称の位置にある 2 マスを組にして一緒に削る（数字の配置が点対称になる）
    const clues = Int8Array.from(full);
    const removedOrder = []; // 削った組（マスの配列）の順
    const n = grid.cellCount;
    // ニコリ風は盤が大きいことが多いので、まず安い推論（深さ 0）で削れるだけ削ってから深くする
    for (let depth = nikoli ? 0 : Math.min(conf.depth, 1); depth <= conf.depth; depth++) {
      const deep = depth >= 2;
      for (const cell of shuffled(n, rng)) {
        if (nikoli && cell > n - 1 - cell) continue; // 組は小さい方のマスで 1 回だけ
        const group = nikoli && cell !== n - 1 - cell ? [cell, n - 1 - cell] : [cell];
        if (clues[group[0]] < 0) continue;
        if (Date.now() > deadline && best) break;
        const saved = group.map((x) => clues[x]);
        for (const x of group) clues[x] = -1;
        const res = solveLogical(grid, clues, { maxDepth: depth, budget: deep ? 10000 : 200000 });
        if (res.status !== 'solved') { group.forEach((x, i) => { clues[x] = saved[i]; }); continue; }
        removedOrder.push(group);
        if (deep && levelAt(clues) >= rank) break;
      }
    }

    // 2〜3. 解き味を見て、難しすぎれば削った順の途中まで戻す
    const withRemoved = (k) => {
      const c = Int8Array.from(full);
      for (let i = 0; i < k; i++) for (const x of removedOrder[i]) c[x] = -1;
      return c;
    };
    let k = removedOrder.length;
    let got = levelAt(clues);
    if (got > rank) {
      // lo は狙い以下、hi は狙いより上（数字を全部残すと定石だけで解ける）
      let lo = 0;
      let hi = k;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (levelAt(withRemoved(mid)) <= rank) lo = mid;
        else hi = mid;
      }
      k = lo;
      got = levelAt(withRemoved(k));
    }
    let finalClues = k === removedOrder.length ? clues : withRemoved(k);
    // ニコリ風：戻したあとも、狙いの難易度を超えない組はもう一度削ってみる（数字を少なくする）
    if (nikoli && k < removedOrder.length) {
      finalClues = Int8Array.from(finalClues);
      for (let i = k + 1; i < removedOrder.length; i++) {
        if (Date.now() > deadline) break;
        const group = removedOrder[i];
        const saved = group.map((x) => finalClues[x]);
        for (const x of group) finalClues[x] = -1;
        const ok = solveLogical(grid, finalClues, { maxDepth: conf.depth, budget: 200000 }).status === 'solved'
          && levelAt(finalClues) === got;
        if (!ok) group.forEach((x, j) => { finalClues[x] = saved[j]; });
      }
    }

    // ヒントが根拠つきで最後まで示せるか（証明つきの手だけで正解まで届くか）
    const proved = solveWithProofs(grid, finalClues, { maxDepth: conf.depth - 1, solution });
    if (!proved.solved || proved.edges.some((v, e) => v !== solution[e])) continue;

    let clueCount = 0;
    for (let i = 0; i < finalClues.length; i++) if (finalClues[i] >= 0) clueCount++;
    const puzzle = { rows, cols, difficulty: LEVELS[got], clues: finalClues, solution, seed: attemptSeed, clueCount };
    // ニコリ風は、数字の割合・定石・仮定の回数まで含めて条件を満たすものだけを合格にする
    let missed = 0;
    if (nikoli) {
      const st = problemStats(difficultyReport({ rows, cols, clues: finalClues, solution }), solution, { rows, cols });
      missed = nikoliCheck({ rows, cols, clues: finalClues, clueCount, ...st }).failed.length;
      puzzle.style = 'nikoli';
      puzzle.styleOk = missed === 0;
    }
    if (got === rank && !missed) return puzzle;
    // 時間切れのときは、外れた条件の少ないもの・狙いの難易度に近いものを返す
    const score = missed * 10 + Math.abs(got - rank);
    if (score < bestScore) { best = puzzle; bestScore = score; }
    if (Date.now() > deadline) return best;
  }
  if (best) return best;
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
