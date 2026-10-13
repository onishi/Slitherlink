/**
 * 定石だけでステージを解き進め、行き詰まったら盤面を解析して定石の候補を足す、をくり返す（開発用）。
 *   node tools/pattern-loop.js [ステージ数] [出力 JSON]
 *
 * 1. 大きさとむずかしさを順に変えながら問題を作る
 * 2. いまの定石（＋ここまでに採用した候補）だけを当てはめて進める
 * 3. 行き詰まったら、その盤面のヒント（最大 10 件）の証明から、使った数字と印だけを取り出す。
 *    盤の縁・角に接する形は、縁・角に合わせた形として取り出す。「輪はひとつだけ」を使う証明は
 *    盤面全体に依存するので除く
 * 4. 2 問以上で出てきた形は、その場で候補として採用し、以後のステージで定石と一緒に使う
 * 5. ヒントの一手を置いて行き詰まりを抜け、2 に戻る
 * 最後に、採用した候補と、採用しなかったが出てきた形を JSON に書き出す。
 */
import { writeFileSync } from 'node:fs';
import { getGrid, UNKNOWN, LINE } from '../src/core/grid.js';
import { generatePuzzle } from '../src/core/generator.js';
import { findHints, analyze } from '../src/core/game.js';
import { PATTERNS, buildPattern, padded } from '../src/core/patterns.js';
import { applyAllPatterns, transformPattern } from '../src/core/pattern-match.js';
import { draw } from './mine-patterns.js';

const stages = Number(process.argv[2] || 100);
const outFile = process.argv[3] || 'pattern-loop.json';
const SIZES = [5, 7, 10, 12, 15];
const LEVELS = ['easy', 'normal', 'hard'];

/* ---------------- 証明から形を取り出す ---------------- */

function collect(proof, acc = { cells: new Set(), vertices: new Set() }) {
  const { clash } = proof;
  if (clash.kind === 'loop' || clash.kind === 'conflict') return null;
  if (clash.kind === 'cell') acc.cells.add(clash.index);
  if (clash.kind === 'vertex') acc.vertices.add(clash.index);
  for (const step of proof.steps) {
    if (step.rule.startsWith('loop')) return null;
    if (step.rule.startsWith('clue')) acc.cells.add(step.cell);
    if (step.rule.startsWith('vertex')) acc.vertices.add(step.vertex);
    if (step.rule === 'case' && !collect(step.sub, acc)) return null;
  }
  return acc;
}

/** 点の座標を変える 8 通りのうち、使うもの（盤面の頂点座標 R×C で定義）。 */
const MAPS = {
  id: (r, c) => [r, c],
  flipV: (r, c, R) => [R - r, c],
  flipH: (r, c, R, C) => [r, C - c],
  rot180: (r, c, R, C) => [R - r, C - c],
  transpose: (r, c) => [c, r],
  // 右の縁を上へ：(r, c) → (C - c, r) を上下反転したものと同じ向きでよい（左右反転で揃えるため）
  rightToTop: (r, c, R, C) => [C - c, r],
};

/**
 * 証明が使った数字・印・結論を、盤面の座標で集める。
 * 点は頂点座標 (r, c)、マスは左上の点、辺は両端の点で持つ。
 */
function rawShape(grid, clues, state, proof, used) {
  const ends = (e) => {
    const a = grid.edgeEnds[e * 2];
    const b = grid.edgeEnds[e * 2 + 1];
    const w = grid.cols + 1;
    return [[Math.floor(a / w), a % w], [Math.floor(b / w), b % w]];
  };
  return {
    clues: [...used.cells].filter((cell) => clues[cell] >= 0)
      .map((cell) => [Math.floor(cell / grid.cols), cell % grid.cols, clues[cell]]),
    given: proof.uses.map((e) => [ends(e), state[e] === LINE ? 'line' : 'cross']),
    conclude: [[ends(proof.edge), proof.value === LINE ? 'line' : 'cross']],
  };
}

/** 点の変換を当てて、定石の形（余白・枠つき）に直す。 */
function toPattern(raw, map, R, C, anchor) {
  const pts = [];
  const clue = raw.clues.map(([r, c, n]) => {
    const a = map(r, c, R, C);
    const b = map(r + 1, c + 1, R, C);
    const p = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), n];
    pts.push([p[0], p[1]], [p[0] + 1, p[1] + 1]);
    return p;
  });
  const mark = ([[p, q], kind]) => {
    const a = map(p[0], p[1], R, C);
    const b = map(q[0], q[1], R, C);
    pts.push(a, b);
    return a[0] === b[0] ? ['h', a[0], Math.min(a[1], b[1]), kind] : ['v', Math.min(a[0], b[0]), a[1], kind];
  };
  const given = raw.given.map(mark);
  const conclude = raw.conclude.map(mark);
  const r0 = Math.min(...pts.map((p) => p[0]));
  const r1 = Math.max(...pts.map((p) => p[0]));
  const c0 = Math.min(...pts.map((p) => p[1]));
  const c1 = Math.max(...pts.map((p) => p[1]));
  // 内側は四方に 1 マスの余白。縁は上（盤の縁）に余白なし。角は上と左に余白なし
  const dr = anchor === 'interior' ? r0 - 1 : 0;
  const dc = anchor === 'corner' ? 0 : c0 - 1;
  const shift = ([d, r, c, k]) => [d, r - dr, c - dc, k];
  return {
    rows: r1 - dr + 1,
    cols: c1 - dc + 1,
    anchor,
    clues: clue.map(([r, c, n]) => [r - dr, c - dc, n]),
    given: given.map(shift),
    conclude: conclude.map(shift),
  };
}

const sorted = (list) => [...list].map((x) => JSON.stringify(x)).sort().join(';');
const keyOf = (p) => `${p.anchor}|${p.rows}x${p.cols}|${sorted(p.clues)}|${sorted(p.given)}`;

/** 形をそろえる（内側は 8 方向、縁は左右反転、角は対角の反転）。いちばん小さい呼び名の向きを使う。 */
function canonical(p) {
  const T = (id, swap, map) => ({ id, swap, map });
  const transforms = p.anchor === 'interior'
    ? [T(0, false, (r, c) => [r, c]), T(1, true, (r, c, R) => [c, R - r]), T(2, false, (r, c, R, C) => [R - r, C - c]),
      T(3, true, (r, c, R, C) => [C - c, r]), T(4, false, (r, c, R, C) => [r, C - c]), T(5, false, (r, c, R) => [R - r, c]),
      T(6, true, (r, c) => [c, r]), T(7, true, (r, c, R, C) => [C - c, R - r])]
    : p.anchor === 'border'
      ? [T(0, false, (r, c) => [r, c]), T(4, false, (r, c, R, C) => [r, C - c])]
      : [T(0, false, (r, c) => [r, c]), T(6, true, (r, c) => [c, r])];
  let best = null;
  for (const t of transforms) {
    const v = transformPattern(p, t);
    const q = { rows: v.rows, cols: v.cols, anchor: p.anchor, clues: v.clues, given: v.given, conclude: v.conclude };
    const key = keyOf(q);
    if (!best || key < best.key) best = { key, pattern: q };
  }
  return best;
}

/** 証明 1 つから定石の候補を作る。作れなければ null。 */
function candidateOf(grid, clues, state, proof) {
  if (proof.kind !== 'contradiction') return null;
  const used = collect(proof);
  if (!used) return null;
  const R = grid.rows;
  const C = grid.cols;
  const w = C + 1;
  const sides = new Set();
  for (const v of used.vertices) {
    if (grid.vertexEdges[v].length === 4) continue;
    const r = Math.floor(v / w);
    const c = v % w;
    if (r === 0) sides.add('top');
    if (r === R) sides.add('bottom');
    if (c === 0) sides.add('left');
    if (c === C) sides.add('right');
  }
  const raw = rawShape(grid, clues, state, proof, used);
  const has = (s) => sides.has(s);
  let shape;
  if (sides.size === 0) shape = toPattern(raw, MAPS.id, R, C, 'interior');
  else if (sides.size === 1) {
    const map = has('top') ? MAPS.id : has('bottom') ? MAPS.flipV : has('left') ? MAPS.transpose : MAPS.rightToTop;
    shape = toPattern(raw, map, R, C, 'border');
  } else if (sides.size === 2 && !(has('top') && has('bottom')) && !(has('left') && has('right'))) {
    const map = has('top') && has('left') ? MAPS.id
      : has('top') && has('right') ? MAPS.flipH
        : has('bottom') && has('left') ? MAPS.flipV : MAPS.rot180;
    shape = toPattern(raw, map, R, C, 'corner');
  } else return null;
  // 大きすぎる形は定石にしない
  if (shape.rows * shape.cols > 30 || shape.given.length + shape.clues.length > 10) return null;
  return canonical(shape);
}

/** その形だけを置いた盤で、いまの定石が結論に届くか（届くなら足す意味が無い）。 */
function reachedBy(pattern, patterns) {
  const board = buildPattern(pattern.anchor === 'interior' ? padded(pattern, 2) : pattern);
  const after = applyAllPatterns(board.grid, board.clues, board.given, patterns);
  return board.conclude.every(({ edge, value }) => after[edge] === value);
}

/* ---------------- くり返し ---------------- */

const working = [...PATTERNS];
const seen = new Map(); // key → { pattern, stages:Set, count }
const adopted = [];
const log = [];

for (let s = 0; s < stages; s++) {
  const size = SIZES[s % SIZES.length];
  const difficulty = LEVELS[Math.floor(s / SIZES.length) % LEVELS.length];
  const puzzle = generatePuzzle({ rows: size, cols: size, difficulty, seed: 90000 + s * 977 });
  const grid = getGrid(size, size);
  let state = new Int8Array(grid.edgeCount);
  let stuck = 0;
  let found = 0;
  for (let guard = 0; guard < grid.edgeCount; guard++) {
    state = applyAllPatterns(grid, puzzle.clues, state, working);
    if (analyze(grid, puzzle.clues, state).solved || !state.includes(UNKNOWN)) break;
    stuck++;
    const hints = findHints(grid, puzzle.clues, state, puzzle.solution);
    if (hints[0].type !== 'move') break;
    for (const hint of hints) {
      const cand = candidateOf(grid, puzzle.clues, state, hint.proof);
      if (!cand) continue;
      found++;
      const entry = seen.get(cand.key) ?? { pattern: cand.pattern, stages: new Set(), count: 0 };
      entry.count++;
      entry.stages.add(s);
      seen.set(cand.key, entry);
      if (entry.stages.size >= 2 && !entry.adopted && !reachedBy(entry.pattern, working)) {
        entry.adopted = true;
        const id = `cand-${adopted.length + 1}`;
        const pattern = { ...entry.pattern, id, title: id, category: 'numbers', level: 3, why: '' };
        adopted.push({ id, stage: s, pattern, count: entry.count, stages: entry.stages.size });
        working.push(pattern);
        console.log(`  ★ ${id} を採用（${entry.stages.size} 問目で 2 回目）\n${draw(pattern)}`);
      }
    }
    // ヒントの一手で行き詰まりを抜ける
    state[hints[0].edge] = hints[0].value;
  }
  const solved = analyze(grid, puzzle.clues, state).solved;
  log.push({ stage: s + 1, size, difficulty, stuck, found, solved });
  console.log(`#${s + 1} ${size}x${size} ${difficulty}: 行き詰まり ${stuck} 回・候補 ${found} 個・採用累計 ${adopted.length}`);
}

const others = [...seen.values()].filter((e) => !e.adopted)
  .sort((a, b) => b.stages.size - a.stages.size || b.count - a.count)
  .slice(0, 30)
  .map((e) => ({ stages: e.stages.size, count: e.count, pattern: e.pattern }));
writeFileSync(outFile, JSON.stringify({ log, adopted, others }, null, 1));
const total = log.reduce((n, x) => n + x.stuck, 0);
console.log(`\n${stages} ステージ・行き詰まり計 ${total} 回・採用 ${adopted.length} 個 → ${outFile}`);
