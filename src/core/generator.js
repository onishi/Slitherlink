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
import { thinkMoves, feelProfile, workRun } from './feel.js';

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
 * 作問のやり方の版。問題集に入れる問題には、どの版で作ったかを残す（あとで版どうしをくらべるため）。
 * 版を変えるときは、古い版もそのまま作れるように残し、ここに足す。
 *   random-1  最初の作り方。ランダムな輪から、数字をランダムな順に削る
 *   nikoli-1  ニコリ風の初版。輪を盤いっぱいにくねらせ、数字を点対称の組で削り、ニコリ風の条件で合格を決める
 *   nikoli-2  ニコリ風の 2 版。数字をむらなく置く（密なところ・1 や 0 から削る、空の行・列や数字のない 3×3 を作らない、
 *             詰まった行・列を間引く）。入門・やさしいも少し先を読む深さまで削り、考える手が 3 回以上あるものだけにする
 *   nikoli-3  ニコリ風の 3 版。2 版に加えて、数字の内訳（0／1／2／3）をニコリに寄せ、考える手が多すぎれば
 *             難易度を保って数字を戻し（入り口が広く、息つける区間ができる）、山場が後半にある問題を選ぶ
 *   nikoli-4  ニコリ風の 4 版。3 版に加えて、考える手の多さの目安をむずかしさごとにニコリに合わせ（入門・やさしいを軽く）、
 *             数字を戻すときは考えさせられた場所の近くから戻す（少ない数字で手触りを作る）
 *   nikoli-5  ニコリ風の 5 版。3 版を元に（4 版の工夫は使わない）、0 を固めずに離して置き（固まった 0 は × を付けるだけの
 *             作業が続く。ニコリの 0 は 8 割がまわり 2 歩以内にほかの 0 が無い）、数字を戻すときは 3・2 から戻し、
 *             候補を選ぶときに作業の続く区間の長さも見る
 */
export const GENERATORS = {
  'random-1': { label: 'ランダム v1', options: {} },
  'nikoli-1': { label: 'ニコリ風 v1', options: { style: 'nikoli', version: 1 } },
  'nikoli-2': { label: 'ニコリ風 v2', options: { style: 'nikoli', version: 2 } },
  'nikoli-3': { label: 'ニコリ風 v3', options: { style: 'nikoli', version: 3 } },
  'nikoli-4': { label: 'ニコリ風 v4', options: { style: 'nikoli', version: 4 } },
  'nikoli-5': { label: 'ニコリ風 v5', options: { style: 'nikoli', version: 5 } },
};
// 最初に選ばれる作り方。4 版は入門・やさしいを軽くできるが、遊び比べでは作業の続く区間が延び、
// 全体としては 3 版のほうがニコリに近かったので、3 版のままにしておく
export const LATEST_GENERATOR = 'nikoli-3';

/** ニコリ（とことん01）の数字の内訳：0, 1, 2, 3 の割合。3 版はこれに寄せて削る。 */
const CLUE_MIX = [0.13, 0.26, 0.29, 0.32];
/**
 * 3 版の手触りの目安（src/core/feel.js の feelProfile）。ニコリの 24×14 ふつうは、
 * 考える手 10 回／100 辺・入り口 0.19／マス・山場の位置 0.60 くらい。
 * むずかしさごとの、考える手の上限（これより多ければ数字を戻す）。
 */
const FEEL_MAX_RATE = { intro: 10, easy: 10, normal: 12, hard: 15, expert: Infinity };
/**
 * 4 版の、むずかしさごとの考える手の目安（決まる辺 100 本あたり）。[下限, 上限]。
 * ニコリの 24×14 は 入門・やさしい 7 前後、ふつう 10 前後。3 版はどの難易度も 10 前後で差が出なかった。
 */
const FEEL_RATE_V4 = { intro: [5, 8], easy: [5, 8], normal: [9, 12], hard: [12, 16], expert: [0, Infinity] };
const FEEL_MIN_OPENINGS = 0.12;
const FEEL_MIN_MID = 0.55;
/**
 * 5 版の、作業の続く区間（src/core/feel.js の workRun）の上限。
 * ニコリの 24×14 は中央値 19 手・平均 22 手、3 版は中央値 29 手だった。
 */
const FEEL_MAX_RUN = 22;

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
 *   ニコリ風の条件（src/core/nikoli.js）を満たすものだけを合格にする。入門・やさしいだけは数字の割合を問わない
 * @param {number} [options.version] ニコリ風の版（1 か 2。省略すると最新）。GENERATORS を参照
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
  // ニコリ風 2 版の工夫（数字をむらなく・3 を残す・入門にも考える手）。1 版はそれ無しで作る
  const version = options.version ?? 3; // 省くと、最初に選ばれる作り方（LATEST_GENERATOR）と同じ版
  const v2 = nikoli && version >= 2;
  // 3 版：数字の内訳をニコリに寄せ、手触り（考える手の多さ・入り口・山場）を合わせる
  const v3 = nikoli && version >= 3;
  // 4 版：むずかしさごとの手触りの目安と、考えさせられた場所の近くから数字を戻す（5 版は使わない）
  const v4 = nikoli && version === 4;
  // 5 版：0 を離して置き、3・2 から数字を戻し、作業の続く区間も見て候補を選ぶ
  const v5 = nikoli && version >= 5;
  const rateRange = (level) => (v4 ? FEEL_RATE_V4[level] : [0, FEEL_MAX_RATE[level]]);
  let best = null; // 時間切れのときに返す、狙いにいちばん近いもの
  let bestScore = Infinity;
  // ニコリ風の入門・やさしいは数字が多めになるので、少しのあいだ作り直して数字のいちばん少ないものを選ぶ
  const relaxClues = nikoli && rank < LEVELS.indexOf('normal');
  // 入門・やさしい（数字が多め）や 3 版の手触りは、少しのあいだ作り直して、いちばん良いものを選ぶ
  //   5 版は作業の続く区間を測る分、長めに選ぶ
  const softMs = v5 ? Math.max(5000, rows * cols * 40) : v3 ? Math.max(3000, rows * cols * 25) : Math.max(2000, rows * cols * 15);
  const softDeadline = Math.min(deadline, Date.now() + softMs);
  let fewest = null;

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
    //    ニコリ風は、入門・やさしいでも少し先を読む深さ（1）まで削ってから難易度に合わせて戻す
    //    （深さ 0 で削ると、盤面を見ただけで決まる手しか無い作業だけの問題になる）
    const clues = Int8Array.from(full);
    const removedOrder = []; // 削った組（マスの配列）の順
    const n = grid.cellCount;
    const cutDepth = v2 ? Math.max(conf.depth, 1) : conf.depth;
    // ニコリ風は盤が大きいことが多いので、まず安い推論（深さ 0）で削れるだけ削ってから深くする
    for (let depth = nikoli ? 0 : Math.min(conf.depth, 1); depth <= cutDepth; depth++) {
      const deep = depth >= 2;
      // ニコリ風は、数字が密なところ・1 や 0 から先に削る（数字をむらなく置き、3 を残しやすくする）
      // 3 版は数字の内訳を見ながら削るので、何組か試すごとに削る順を作り直す
      const tried = new Set();
      const refreshEvery = Math.max(4, Math.floor(n / 24));
      const nextOrder = () => (v2 ? evenRemovalOrder(grid, clues, rng, v3 ? CLUE_MIX : null, v5) : shuffled(n, rng)).filter((c) => !tried.has(c));
      let order = nextOrder();
      let stop = false;
      while (order.length && !stop) {
      let used = 0;
      for (const cell of order) {
        if (v3 && used >= refreshEvery) break;
        tried.add(cell);
        used++;
        if (nikoli && cell > n - 1 - cell) continue; // 組は小さい方のマスで 1 回だけ
        const group = nikoli && cell !== n - 1 - cell ? [cell, n - 1 - cell] : [cell];
        if (clues[group[0]] < 0) continue;
        // ニコリ風は、空の行・列や数字のない 3×3 ができる削り方はしない
        if (v2 && leavesHole(grid, clues, group)) continue;
        if (Date.now() > deadline && best) { stop = true; break; }
        const saved = group.map((x) => clues[x]);
        for (const x of group) clues[x] = -1;
        const res = solveLogical(grid, clues, { maxDepth: depth, budget: deep ? 10000 : 200000 });
        if (res.status !== 'solved') { group.forEach((x, i) => { clues[x] = saved[i]; }); continue; }
        removedOrder.push(group);
        if (deep && levelAt(clues) >= rank) { stop = true; break; }
      }
      if (!v3) break;
      order = nextOrder();
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
        if (finalClues[group[0]] < 0) continue;
        if (v2 && leavesHole(grid, finalClues, group)) continue;
        for (const x of group) finalClues[x] = -1;
        const ok = solveLogical(grid, finalClues, { maxDepth: cutDepth, budget: 200000 }).status === 'solved'
          && levelAt(finalClues) === got;
        if (!ok) group.forEach((x, j) => { finalClues[x] = saved[j]; });
      }
    }

    // ヒントが根拠つきで最後まで示せるか（証明つきの手だけで正解まで届くか）
    // ニコリ風の仕上げ：数字が 7 割以上並ぶ行・列（ニコリの問題には無い）を、難易度を保って削れるだけ削る
    const keepsLevel = (c) => solveLogical(grid, c, { maxDepth: cutDepth, budget: 200000 }).status === 'solved' && levelAt(c) === got;
    if (v2) finalClues = thinDenseLines(grid, finalClues, keepsLevel, deadline);
    // 5 版の仕上げ：近くにほかの 0 がある 0 を、難易度を保って削れるだけ削る（0 が固まると × を付けるだけの作業が続く）
    //   むずかしいは難易度を確かめるのが重い（仮定を探す）ので、削る順で 0 を離すだけにする
    if (v5 && got <= LEVELS.indexOf('normal')) finalClues = thinZeros(grid, finalClues, keepsLevel, deadline);

    // 3 版の仕上げ：考える手が多すぎれば（休む間がない・入り口が狭い）、難易度を変えない範囲で数字を戻す
    let feel = null;
    if (v3) {
      const eased = easeFeel(grid, finalClues, full, removedOrder, solution, rateRange(LEVELS[got])[1], v4 ? 'think' : v5 ? 'value' : null,
        (c) => levelAt(c) === got && (got < LEVELS.indexOf('normal') || countOf(c) < grid.cellCount * 0.5), deadline);
      finalClues = eased.clues;
      feel = eased.feel;
    }

    const proved = solveWithProofs(grid, finalClues, { maxDepth: Math.max(0, cutDepth - 1), solution });
    if (!proved.solved || proved.edges.some((v, e) => v !== solution[e])) continue;

    let clueCount = 0;
    for (let i = 0; i < finalClues.length; i++) if (finalClues[i] >= 0) clueCount++;
    const puzzle = { rows, cols, difficulty: LEVELS[got], clues: finalClues, solution, seed: attemptSeed, clueCount };
    // ニコリ風は、数字の割合・定石・仮定の回数まで含めて条件を満たすものだけを合格にする
    //    入門・やさしいは定石だけで解けるよう数字を多めに残すので、「数字 50% 未満」だけは合格の条件から外す
    //    （点対称と輪の形は守る）。styleOk はゆるめずに、全部満たしたかを正直に返す
    let missed = 0;
    if (nikoli) {
      const st = problemStats(difficultyReport({ rows, cols, clues: finalClues, solution }), solution, { rows, cols });
      const failed = nikoliCheck({ rows, cols, clues: finalClues, clueCount, ...st }).failed;
      missed = failed.filter((f) => !(f === '数字' && rank < LEVELS.indexOf('normal'))).length;
      // 入門・やさしいでも、少し先を読む手が 3 回はある問題にする（作業だけで終わらないように）
      if (v2 && rank < LEVELS.indexOf('normal') && thinkMoves({ rows, cols, clues: finalClues, solution }, 3) < 3) missed++;
      puzzle.style = 'nikoli';
      puzzle.styleOk = failed.length === 0;
    }
    // 3 版は手触り（考える手の多さ・入り口・山場）も見る。合わなければ少しのあいだ作り直して、近いものを選ぶ
    let feelMiss = v3 ? feelGap(feel, rateRange(LEVELS[got])) : 0;
    // 5 版：ほかの目安が合うものだけ、作業の続く区間も見る（重いので打ち切りつき）
    if (v5 && got === rank && !missed && feelMiss === 0) {
      const run = workRun({ rows, cols, clues: finalClues, solution }, FEEL_MAX_RUN * 2);
      feelMiss += Math.max(0, run - FEEL_MAX_RUN) / 10;
      puzzle.workRun = run;
    }
    if (feel) puzzle.feel = feel;
    if (got === rank && !missed) {
      if ((!relaxClues || puzzle.styleOk) && feelMiss === 0) return puzzle;
      const key = (q) => [q.styleOk ? 0 : 1, q.feelMiss ?? 0, q.clueCount];
      puzzle.feelMiss = feelMiss;
      if (!fewest || compareKeys(key(puzzle), key(fewest)) < 0) fewest = puzzle;
      if (Date.now() > softDeadline) return fewest;
      continue;
    }
    // 時間切れのときは、外れた条件の少ないもの・狙いの難易度に近いものを返す
    const score = missed * 10 + Math.abs(got - rank);
    if (score < bestScore) { best = puzzle; bestScore = score; }
    if (Date.now() > deadline) return fewest ?? best;
  }
  if (fewest) return fewest;
  if (best) return best;
  throw new Error('問題の生成に失敗しました');
}

const countOf = (clues) => { let k = 0; for (let i = 0; i < clues.length; i++) if (clues[i] >= 0) k++; return k; };
const compareKeys = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

/** 手触りが目安からどれだけ外れているか（0 なら合格）。range は考える手の [下限, 上限]。 */
function feelGap(feel, range) {
  if (!feel) return 1;
  return Math.max(0, feel.thinkRate - range[1]) / 4 + Math.max(0, range[0] - feel.thinkRate) / 4
    + Math.max(0, FEEL_MIN_OPENINGS - feel.openings) * 10
    + (feel.thinkMid == null ? 0 : Math.max(0, FEEL_MIN_MID - feel.thinkMid) * 10);
}

/**
 * 考える手が多すぎるとき、最後に削った組から順に数字を戻す（ok を保てるものだけ）。
 * order が 'think' なら考えさせられた場所の近くから（4 版）、'value' なら 3・2 の組から（5 版）戻す。
 * 数字が 6 割以上並ぶ行・列には戻さない（むらを作らない）。
 * 手触りを測るのは重い（24×14 で 1 秒ほど）ので、何組かずつまとめて戻しては測る。
 * 1 組あたりで考える手がどれだけ減ったかから、目安に届くのに要る組の数を見積もり、戻しすぎないようにする。
 * @returns {{clues: Int8Array, feel: object}}
 */
function easeFeel(grid, clues, full, removedOrder, solution, max, order, ok, deadline) {
  const nearThink = order === 'think';
  const out = Int8Array.from(clues);
  const { rows, cols } = grid;
  let feel = feelProfile({ rows, cols, clues: out, solution });
  const crowded = (cell) => {
    const r = Math.floor(cell / cols);
    const c = cell % cols;
    let rowN = 0;
    let colN = 0;
    for (let x = 0; x < cols; x++) if (out[r * cols + x] >= 0) rowN++;
    for (let y = 0; y < rows; y++) if (out[y * cols + c] >= 0) colN++;
    return rowN + 1 > cols * 0.6 || colN + 1 > rows * 0.6;
  };
  let back = removedOrder.slice().reverse().filter((g) => g.every((x) => out[x] < 0));
  // 4 版：考えさせられた辺のまわりの数字から戻す（その場所の詰まりをほどく数字なので、少ない数字で済む）
  const byThink = () => {
    const near = new Map();
    for (const e of feel.thinkEdges ?? []) {
      for (const cell of grid.edgeCells[e]) {
        const r = Math.floor(cell / cols);
        const c = cell % cols;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          const k = rr * cols + cc;
          near.set(k, (near.get(k) ?? 0) + (dr === 0 && dc === 0 ? 2 : 1));
        }
      }
    }
    const score = (g) => g.reduce((a, x) => a + (near.get(x) ?? 0), 0);
    back = back.slice(i).sort((a, b) => score(b) - score(a));
    i = 0;
  };
  let i = 0;
  if (nearThink) byThink();
  // 5 版：3・2 の組から戻す（線を引く手が出る数字なので、× を付けるだけの作業が続かない）。0 は最後
  if (order === 'value') {
    const worth = (g) => g.reduce((a, x) => a + [-3, 0, 1, 2][full[x]], 0);
    back = back.map((g, j) => [g, j]).sort((a, b) => worth(b[0]) - worth(a[0]) || a[1] - b[1]).map(([g]) => g);
  }
  // はじめの見積もり（控えめに）。4 版は狙った場所の数字なので 1 組の効き目が大きく、1〜2 組ずつ戻す
  const stepCap = nearThink ? 2 : 3;
  let step = nearThink ? 2 : Math.max(1, Math.ceil(back.length / 12));
  for (let round = 0; round < (nearThink ? 16 : 10) && i < back.length && feel.thinkRate > max; round++) {
    if (Date.now() > deadline) break;
    const before = feel.thinkRate;
    let added = 0;
    while (i < back.length && added < step) {
      const group = back[i++];
      if (group.some(crowded)) continue;
      // 5 版：近くにほかの 0 がある 0 は戻さない
      if (order === 'value' && group.some((x) => full[x] === 0 && zerosNear(grid, out, x) > 0)) continue;
      for (const x of group) out[x] = full[x];
      if (ok(out)) added++;
      else for (const x of group) out[x] = -1;
    }
    if (!added) break;
    feel = feelProfile({ rows, cols, clues: out, solution });
    if (nearThink) byThink();
    // 1 組あたりの減り方から、あと何組で目安に届くかを見積もる。見積もりは揺れるので、2 回目からは小刻みに
    const perGroup = (before - feel.thinkRate) / added;
    step = perGroup > 0 ? Math.min(stepCap, Math.max(1, Math.ceil((feel.thinkRate - max) / perGroup))) : step;
  }
  return { clues: out, feel };
}

/**
 * ニコリ風の数字の削る順。数字が密なところ（同じ行・列、まわりの 3×3 に数字が多い）と、
 * 1・0・2 を先に、3 は後に回す（ニコリの問題は 3 が 4 割で、数字がむらなく散っている）。
 * 少しだけ乱数を混ぜて、毎回同じ形にならないようにする。
 */
const KEEP_WEIGHT = [2, 3, 1, -2]; // 数字ごとの「先に削る」重み：0, 1, 2, 3
function evenRemovalOrder(grid, clues, rng, mix = null, apartZeros = false) {
  const { rows, cols, cellCount } = grid;
  // 3 版：いまの内訳が目安より多い数字ほど先に削る
  let weight = KEEP_WEIGHT;
  if (mix) {
    const h = [0, 0, 0, 0];
    let total = 0;
    for (let i = 0; i < cellCount; i++) if (clues[i] >= 0) { h[clues[i]]++; total++; }
    weight = mix.map((target, v) => (total ? (4 * (h[v] / total - target)) / target : 0));
  }
  const rowN = new Int32Array(rows);
  const colN = new Int32Array(cols);
  for (let i = 0; i < cellCount; i++) {
    if (clues[i] < 0) continue;
    rowN[Math.floor(i / cols)]++;
    colN[i % cols]++;
  }
  const score = new Float64Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    if (clues[i] < 0) { score[i] = -Infinity; continue; }
    const r = Math.floor(i / cols);
    const c = i % cols;
    let near = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && clues[rr * cols + cc] >= 0) near++;
      }
    }
    score[i] = rowN[r] / cols + colN[c] / rows + near / 3 + weight[clues[i]] + rng() * 1.5;
    // 5 版：近くにほかの 0 がある 0 を先に削る（ニコリの 0 は 8 割が離れて置かれている）
    if (apartZeros && clues[i] === 0) score[i] += 2 * zerosNear(grid, clues, i);
  }
  // 組（点対称の 2 マス）は合わせた点で並べる
  const order = Array.from({ length: cellCount }, (_, i) => i);
  const pairScore = (i) => score[i] + score[cellCount - 1 - i];
  return order.sort((a, b) => pairScore(b) - pairScore(a));
}

/**
 * 数字が 7 割以上並ぶ行・列から、ok(盤) を保てる点対称の組を削る。3 は後回し。
 * @returns {Int8Array} 削ったあとの数字
 */
function thinDenseLines(grid, clues, ok, deadline) {
  const { rows, cols, cellCount } = grid;
  const out = Int8Array.from(clues);
  const lineCount = (cell) => {
    const r = Math.floor(cell / cols);
    const c = cell % cols;
    let rowN = 0;
    let colN = 0;
    for (let x = 0; x < cols; x++) if (out[r * cols + x] >= 0) rowN++;
    for (let y = 0; y < rows; y++) if (out[y * cols + c] >= 0) colN++;
    return Math.max(rowN / cols, colN / rows);
  };
  for (let pass = 0; pass < 3; pass++) {
    const dense = [];
    for (let i = 0; i < cellCount; i++) {
      if (out[i] < 0 || i > cellCount - 1 - i) continue;
      const share = Math.max(lineCount(i), lineCount(cellCount - 1 - i));
      if (share >= 0.7) dense.push([i, share - (out[i] === 3 ? 1 : 0)]);
    }
    if (!dense.length) break;
    dense.sort((a, b) => b[1] - a[1]);
    let changed = false;
    for (const [cell] of dense) {
      if (Date.now() > deadline) return out;
      const group = cell === cellCount - 1 - cell ? [cell] : [cell, cellCount - 1 - cell];
      if (out[cell] < 0 || Math.max(lineCount(cell), lineCount(group[group.length - 1])) < 0.7) continue;
      if (leavesHole(grid, out, group)) continue;
      const saved = group.map((x) => out[x]);
      for (const x of group) out[x] = -1;
      if (ok(out)) changed = true;
      else group.forEach((x, j) => { out[x] = saved[j]; });
    }
    if (!changed) break;
  }
  return out;
}

/** cell から 2 歩以内（上下左右に数えて）にある、ほかの 0 の数。 */
function zerosNear(grid, clues, cell) {
  const { rows, cols } = grid;
  const r = Math.floor(cell / cols);
  const c = cell % cols;
  let k = 0;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if ((!dr && !dc) || Math.abs(dr) + Math.abs(dc) > 2) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && clues[rr * cols + cc] === 0) k++;
    }
  }
  return k;
}

/**
 * 近くにほかの 0 がある 0 から、ok(盤) を保てる点対称の組を削る（固まった 0 のいちばん混んだものから）。
 * @returns {Int8Array} 削ったあとの数字
 */
function thinZeros(grid, clues, ok, deadline) {
  const n = grid.cellCount;
  const out = Int8Array.from(clues);
  for (let pass = 0; pass < 3; pass++) {
    const crowded = [];
    for (let i = 0; i < n; i++) {
      if (out[i] !== 0) continue;
      const k = zerosNear(grid, out, i);
      if (k) crowded.push([Math.min(i, n - 1 - i), k]);
    }
    if (!crowded.length) break;
    crowded.sort((a, b) => b[1] - a[1]);
    let changed = false;
    for (const [cell] of crowded) {
      if (Date.now() > deadline) return out;
      const group = cell === n - 1 - cell ? [cell] : [cell, n - 1 - cell];
      if (out[cell] < 0 || !group.some((x) => out[x] === 0 && zerosNear(grid, out, x) > 0)) continue;
      if (leavesHole(grid, out, group)) continue;
      const saved = group.map((x) => out[x]);
      for (const x of group) out[x] = -1;
      if (ok(out)) changed = true;
      else group.forEach((x, j) => { out[x] = saved[j]; });
    }
    if (!changed) break;
  }
  return out;
}

/** group の数字を消すと、空の行・列や、数字の 1 つもない 3×3 ができるか。 */
function leavesHole(grid, clues, group) {
  const { rows, cols } = grid;
  const gone = new Set(group);
  const has = (r, c) => clues[r * cols + c] >= 0 && !gone.has(r * cols + c);
  for (const cell of group) {
    const r = Math.floor(cell / cols);
    const c = cell % cols;
    let rowAny = false;
    for (let x = 0; x < cols && !rowAny; x++) rowAny = has(r, x);
    if (!rowAny) return true;
    let colAny = false;
    for (let y = 0; y < rows && !colAny; y++) colAny = has(y, c);
    if (!colAny) return true;
    // このマスを含む 3×3 の窓（盤の中に収まるもの）
    for (let r0 = Math.max(0, r - 2); r0 <= Math.min(rows - 3, r); r0++) {
      for (let c0 = Math.max(0, c - 2); c0 <= Math.min(cols - 3, c); c0++) {
        let any = false;
        for (let i = 0; i < 3 && !any; i++) for (let j = 0; j < 3 && !any; j++) any = has(r0 + i, c0 + j);
        if (!any) return true;
      }
    }
  }
  return false;
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
