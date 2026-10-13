/**
 * ヒントの証明から、定石の候補を洗い出す（開発用）。
 *   node tools/mine-patterns.js [1 条件あたりの問題数] [表示する候補数]
 *
 * 1. 作問した問題をヒントどおりに解き進める
 *    （盤面だけで直接決まるヒントが定石で拾えなければ、それも数える。基本ルールの抜け）
 * 2. 背理法のヒントのうち、いまの定石を繰り返し当てはめても届かない辺を拾う
 * 3. 証明が実際に使った数字と印だけを取り出し、回転・反転をそろえて数える
 *    （「輪はひとつだけ」を使う証明は盤面全体に依存するので除く。
 *     盤の縁の点を使う証明も、縁ごとの形になるので別に数えるだけにする）
 * 4. 多いものから、その形だけを余白つきの盤に置いて、定石だけでは届かないかを確かめる
 */
import { getGrid, UNKNOWN, LINE, CROSS } from '../src/core/grid.js';
import { generatePuzzle } from '../src/core/generator.js';
import { findHint, analyze } from '../src/core/game.js';
import { PATTERNS, buildPattern, padded } from '../src/core/patterns.js';
import { applyAllPatterns, orientationsOf } from '../src/core/pattern-match.js';

const reps = Number(process.argv[2] || 6);
const top = Number(process.argv[3] || 15);
const SETS = [[7, 7, 'normal'], [10, 10, 'normal'], [7, 7, 'hard'], [10, 10, 'hard']];

/** 定石を当てはめられるだけ当てはめた盤面。 */
export function closure(grid, clues, state, patterns = PATTERNS) {
  return applyAllPatterns(grid, clues, state, patterns);
}

/** 証明が使った数字のマスと交点を集める。輪のルールを使っていたら null。 */
function collect(proof, acc = { cells: new Set(), vertices: new Set() }) {
  if (proof.clash.kind === 'loop') return null;
  if (proof.clash.kind === 'cell') acc.cells.add(proof.clash.index);
  if (proof.clash.kind === 'vertex') acc.vertices.add(proof.clash.index);
  if (proof.clash.kind === 'conflict') return null;
  for (const step of proof.steps) {
    if (step.rule.startsWith('loop')) return null;
    if (step.rule.startsWith('clue')) acc.cells.add(step.cell);
    if (step.rule.startsWith('vertex')) acc.vertices.add(step.vertex);
    if (step.rule === 'case' && !collect(step.sub, acc)) return null;
  }
  return acc;
}

const markOf = (grid, e, value) => {
  const { dir, r, c } = grid.edgeInfo[e];
  return [dir, r, c, value === LINE ? 'line' : 'cross'];
};

/** 証明から、その形だけを抜き出した定石の形（余白 1 マス）。 */
function shapeOf(grid, clues, state, proof, used) {
  const marks = proof.uses.map((e) => markOf(grid, e, state[e]));
  const cells = [...used.cells].filter((cell) => clues[cell] >= 0);
  const conclusion = markOf(grid, proof.edge, proof.value);
  let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
  const take = (r, c) => { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); };
  for (const cell of cells) {
    const r = Math.floor(cell / grid.cols), c = cell % grid.cols;
    take(r, c); take(r + 1, c + 1);
  }
  for (const [dir, r, c] of [...marks, conclusion]) {
    take(r, c);
    if (dir === 'h') take(r, c + 1); else take(r + 1, c);
  }
  const dr = r0 - 1, dc = c0 - 1;
  return {
    rows: r1 - r0 + 2,
    cols: c1 - c0 + 2,
    anchor: 'interior',
    clues: cells.map((cell) => [Math.floor(cell / grid.cols) - dr, (cell % grid.cols) - dc, clues[cell]]),
    given: marks.map(([d, r, c, k]) => [d, r - dr, c - dc, k]),
    conclude: [[conclusion[0], conclusion[1] - dr, conclusion[2] - dc, conclusion[3]]],
  };
}

const sorted = (list) => [...list].map((x) => JSON.stringify(x)).sort().join(';');

/** 回転・反転をそろえた呼び名と、その向きの形。 */
function canonical(shape) {
  let best = null;
  for (const v of orientationsOf(shape)) {
    const key = `${v.rows}x${v.cols}|${sorted(v.clues)}|${sorted(v.given)}`;
    if (!best || key < best.key) best = { key, shape: v };
  }
  return best;
}

/** 形を文字の図にする。 */
export function draw(p) {
  const out = [];
  const mark = (dir, r, c) => {
    const g = p.given.find((m) => m[0] === dir && m[1] === r && m[2] === c);
    const k = p.conclude.find((m) => m[0] === dir && m[1] === r && m[2] === c);
    if (g) return g[3] === 'line' ? (dir === 'h' ? '───' : '│') : (dir === 'h' ? ' × ' : '×');
    if (k) return k[3] === 'line' ? (dir === 'h' ? '═══' : '║') : (dir === 'h' ? ' ⊗ ' : '⊗');
    return dir === 'h' ? '   ' : ' ';
  };
  for (let r = 0; r <= p.rows; r++) {
    let line = '';
    for (let c = 0; c < p.cols; c++) line += '·' + mark('h', r, c);
    out.push(line + '·');
    if (r === p.rows) break;
    line = '';
    for (let c = 0; c <= p.cols; c++) {
      line += mark('v', r, c);
      if (c < p.cols) {
        const clue = p.clues.find(([cr, cc]) => cr === r && cc === c);
        line += clue ? ` ${clue[2]} ` : '   ';
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = new Map();
  let hints = 0, beyond = 0, loopOnes = 0, borderOnes = 0, puzzles = 0;
  // 盤面だけで直接決まるのに定石で拾えない手（基本ルールの抜けを見つけるため）
  const directMissed = new Map();

  for (const [rows, cols, difficulty] of SETS) {
    for (let i = 0; i < reps; i++) {
      const p = generatePuzzle({ rows, cols, difficulty, seed: 5000 + i * 101 + rows });
      const grid = getGrid(rows, cols);
      const state = new Int8Array(grid.edgeCount);
      puzzles++;
      for (let step = 0; step < grid.edgeCount; step++) {
        if (analyze(grid, p.clues, state).solved) break;
        const hint = findHint(grid, p.clues, state, p.solution);
        if (hint.type !== 'move') break;
        hints++;
        if (hint.proof.kind === 'direct' && closure(grid, p.clues, state)[hint.edge] === UNKNOWN) {
          const rule = hint.proof.step.rule;
          directMissed.set(rule, (directMissed.get(rule) ?? 0) + 1);
        }
        if (hint.proof.kind === 'contradiction' && closure(grid, p.clues, state)[hint.edge] === UNKNOWN) {
          beyond++;
          const used = collect(hint.proof);
          if (!used) loopOnes++;
          else if ([...used.vertices].some((v) => grid.vertexEdges[v].length < 4)) borderOnes++;
          else {
            const { key, shape } = canonical(shapeOf(grid, p.clues, state, hint.proof, used));
            const entry = found.get(key) ?? { shape, count: 0, puzzles: new Set() };
            entry.count++;
            entry.puzzles.add(puzzles);
            found.set(key, entry);
          }
        }
        state[hint.edge] = hint.value;
      }
    }
  }

  console.log(`${puzzles} 問 / ヒント ${hints} 手 / 定石では届かない背理法 ${beyond} 手`);
  console.log(`盤面だけで直接決まるのに定石で拾えない手: ${[...directMissed].map(([r, n]) => `${r} ${n}`).join('・') || 'なし'}`);
  console.log(`  うち 輪のルールを使う ${loopOnes}・縁の点を使う ${borderOnes}・内側の形 ${beyond - loopOnes - borderOnes}（${found.size} 種類）\n`);

  const ranked = [...found.values()].sort((a, b) => b.puzzles.size - a.puzzles.size || b.count - a.count);
  let shown = 0;
  for (const entry of ranked) {
    if (shown >= top) break;
    // その形だけを置いた盤で、いまの定石が届くか
    const board = buildPattern(padded(entry.shape, 2));
    const after = closure(board.grid, board.clues, board.given);
    const reach = board.conclude.every(({ edge }) => after[edge] !== UNKNOWN);
    shown++;
    console.log(`#${shown}  ${entry.puzzles.size} 問・${entry.count} 回  ${reach ? '（形だけなら定石で届く）' : '★ 定石では届かない'}`);
    console.log(JSON.stringify({ rows: entry.shape.rows, cols: entry.shape.cols, clues: entry.shape.clues, given: entry.shape.given, conclude: entry.shape.conclude }));
    console.log(draw(entry.shape) + '\n');
  }
}
