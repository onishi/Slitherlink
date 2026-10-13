import test from 'node:test';
import assert from 'node:assert/strict';
import { getGrid, UNKNOWN, LINE, CROSS } from '../src/core/grid.js';
import { generatePuzzle, DIFFICULTIES } from '../src/core/generator.js';
import { decodePuzzle, solutionFor } from '../src/core/puzzle.js';
import { analyze, findHint, findHints } from '../src/core/game.js';
import {
  boardState, checkProof, findProof, refute, solveWithProofs,
} from '../src/core/proof.js';

// ソルバの探索順しだいで途中から先へ進めなくなり、以前はヒントが止まっていた問題
const STUCK_BEFORE = '10x10:h:a2b1c3b3a32a121a2i1a3b2a12c3123a1c2c3c2e311a212f21a31a222a0c222b1b';

/** 背理法の証明が出てくるまでヒントを進める。 */
function firstContradiction(seed = 2024) {
  const p = generatePuzzle({ rows: 7, cols: 7, difficulty: 'normal', seed });
  const g = getGrid(7, 7);
  const state = new Int8Array(g.edgeCount);
  for (let i = 0; i < 500; i++) {
    const hint = findHint(g, p.clues, state, p.solution);
    if (hint.type !== 'move') break;
    if (hint.proof.kind === 'contradiction' && hint.proof.steps.length >= 2) return { p, g, state, proof: hint.proof };
    state[hint.edge] = hint.value;
  }
  throw new Error('背理法のヒントが出てこない');
}

for (const [rows, cols] of [[6, 6], [8, 8], [10, 10]]) {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    test(`${rows}x${cols} ${DIFFICULTIES[difficulty].label}: 証明つきの手だけで正解まで届く`, () => {
      for (const seed of [11, 22]) {
        const p = generatePuzzle({ rows, cols, difficulty, seed: seed * rows });
        const g = getGrid(rows, cols);
        // 正解は使わない（両方の値を仮定して試す）
        const res = solveWithProofs(g, p.clues, { maxDepth: DIFFICULTIES[difficulty].depth - 1 });
        assert.equal(res.solved, true, `seed ${seed}: 途中で止まった`);
        assert.deepEqual([...res.edges], [...p.solution], '正解と違う答えに着いた');
      }
    });
  }
}

test('以前ヒントが止まった問題も、ヒントだけで最後まで解ける', () => {
  const puzzle = decodePuzzle(STUCK_BEFORE);
  const g = getGrid(puzzle.rows, puzzle.cols);
  const solution = solutionFor(puzzle);
  assert.ok(solution);
  const state = new Int8Array(g.edgeCount);
  for (let i = 0; i < g.edgeCount; i++) {
    if (analyze(g, puzzle.clues, state).solved) break;
    const hint = findHint(g, puzzle.clues, state, solution);
    assert.equal(hint.type, 'move', `${i} 手目でヒントが止まった: ${hint.message}`);
    assert.ok(checkProof(g, puzzle.clues, state, hint.proof), '検算に通らない証明が出た');
    state[hint.edge] = hint.value;
  }
  assert.equal(analyze(g, puzzle.clues, state).solved, true);
});

test('ヒントには必ず検算に通る証明が付き、手順が書かれている', () => {
  const p = generatePuzzle({ rows: 8, cols: 8, difficulty: 'hard', seed: 31 });
  const g = getGrid(8, 8);
  const state = new Int8Array(g.edgeCount);
  let contradictions = 0;
  for (let i = 0; i < 1000; i++) {
    if (analyze(g, p.clues, state).solved) break;
    const hint = findHint(g, p.clues, state, p.solution);
    assert.equal(hint.type, 'move', hint.message);
    assert.ok(checkProof(g, p.clues, state, hint.proof));
    assert.equal(hint.value, p.solution[hint.edge]);
    if (hint.proof.kind === 'contradiction') {
      contradictions++;
      assert.equal(hint.steps[0].kind, 'assume');
      assert.equal(hint.steps.at(-1).kind, 'clash');
      assert.ok(hint.steps.every((s) => s.text.length > 5));
      // 根拠として光らせる辺は、盤面にすでにある印だけ
      for (const e of hint.focus.edges) assert.notEqual(state[e], UNKNOWN);
      // 仮定で置く印は、盤面ではまだ空白の辺だけ
      for (const t of hint.focus.trial) assert.equal(state[t.edge], UNKNOWN);
    } else {
      assert.equal(hint.steps.length, 0);
    }
    state[hint.edge] = hint.value;
  }
  assert.equal(analyze(g, p.clues, state).solved, true);
  assert.ok(contradictions > 0, '背理法のヒントが一度も出ていない');
});

test('検算は、手を抜いたり書き換えたりした証明を通さない', () => {
  const { p, g, state, proof } = firstContradiction();
  assert.ok(checkProof(g, p.clues, state, proof));

  const clone = () => structuredClone(proof);

  const dropped = clone();
  dropped.steps.splice(0, 1);
  assert.equal(checkProof(g, p.clues, state, dropped), false, '手を 1 つ抜いても通った');

  const flipped = clone();
  flipped.steps[0].value = flipped.steps[0].value === LINE ? CROSS : LINE;
  assert.equal(checkProof(g, p.clues, state, flipped), false, '手の結論を逆にしても通った');

  const noPremise = clone();
  noPremise.steps[0].premises = [];
  assert.equal(checkProof(g, p.clues, state, noPremise), false, '前提を消しても通った');

  const reversed = clone();
  reversed.value = reversed.assume;
  assert.equal(checkProof(g, p.clues, state, reversed), false, '結論を逆にしても通った');

  const noClash = clone();
  noClash.clash = { kind: 'cell', index: 0, premises: [] };
  assert.equal(checkProof(g, p.clues, state, noClash), false, '矛盾を差し替えても通った');
});

test('正しい値を否定する証明は作れない', () => {
  const p = generatePuzzle({ rows: 6, cols: 6, difficulty: 'normal', seed: 99 });
  const g = getGrid(6, 6);
  const board = new Int8Array(g.edgeCount);
  const base = boardState(g, p.clues, board);
  for (let e = 0; e < g.edgeCount; e++) {
    assert.equal(refute(base, e, p.solution[e], 1), null, `辺 ${e} の正しい値が否定された`);
  }
});

test('盤面に証明できる手が無ければ null', () => {
  const g = getGrid(3, 3);
  const clues = new Int8Array(9).fill(-1); // 数字が無いので何も決まらない
  assert.equal(findProof(g, clues, new Int8Array(g.edgeCount)), null);
});

test('論理だけでは解けない問題コードは受け付けない', () => {
  // 1 が 1 つだけでは答えがいくつもある
  assert.equal(solutionFor(decodePuzzle('3x3:n:d1d')), null);
  // 生成した問題は受け付けて、正解を返す
  const p = generatePuzzle({ rows: 6, cols: 6, difficulty: 'hard', seed: 5 });
  assert.deepEqual([...solutionFor(p)], [...p.solution]);
});

test('ヒントの候補は複数返り、どれも検算に通り、同じ理由の手は重ならない', () => {
  const p = generatePuzzle({ rows: 7, cols: 7, difficulty: 'normal', seed: 4242 });
  const g = getGrid(7, 7);
  const state = new Int8Array(g.edgeCount);
  let pagedAt = 0;
  for (let i = 0; i < 200; i++) {
    if (analyze(g, p.clues, state).solved) break;
    const list = findHints(g, p.clues, state, p.solution);
    assert.ok(list.length >= 1 && list.length <= 10);
    assert.equal(list[0].edge, findHint(g, p.clues, state, p.solution).edge, '先頭が findHint と違う');
    if (list[0].type !== 'move') break;
    if (list.length > 1) pagedAt++;
    const keys = new Set();
    for (const hint of list) {
      assert.equal(hint.type, 'move');
      assert.ok(checkProof(g, p.clues, state, hint.proof), '検算に通らないヒントが混じった');
      assert.equal(hint.value, p.solution[hint.edge]);
      const s = hint.proof.step;
      const key = hint.proof.kind === 'direct'
        ? `${s.rule}:${s.cell ?? ''}:${s.vertex ?? ''}:${s.cell == null && s.vertex == null ? hint.edge : ''}`
        : `edge:${hint.edge}`;
      assert.ok(!keys.has(key), `同じ理由の手が 2 回出た: ${key}`);
      keys.add(key);
    }
    state[list[0].edge] = list[0].value;
  }
  assert.ok(pagedAt > 10, `ほかのヒントを出せた場面が ${pagedAt} 回しかない`);
});
