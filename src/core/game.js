/**
 * 遊んでいる最中の判定まわり。UI から切り離してテストできるようにしている。
 */

import { UNKNOWN, LINE, CROSS } from './grid.js';
import { solveLogical } from './solver.js';
import { collectProofs, proofSize } from './proof.js';

/**
 * 盤面の今の状態を調べる。
 * @returns {{satisfied:number, total:number, badCells:number[], badVertices:number[],
 *            solved:boolean, closedButWrong:boolean}}
 */
export function analyze(grid, clues, state) {
  const badCells = [];
  const badVertices = [];
  let satisfied = 0;
  let total = 0;
  let cluesOk = true;

  for (let cell = 0; cell < grid.cellCount; cell++) {
    const clue = clues[cell];
    if (clue < 0) continue;
    total++;
    let lines = 0, unknown = 0;
    for (let k = 0; k < 4; k++) {
      const v = state[grid.cellEdges[cell * 4 + k]];
      if (v === LINE) lines++;
      else if (v === UNKNOWN) unknown++;
    }
    if (lines === clue) satisfied++;
    else cluesOk = false;
    if (lines > clue || lines + unknown < clue) badCells.push(cell);
  }

  let lineCount = 0;
  let degreeOk = true;
  for (let v = 0; v < grid.vertexCount; v++) {
    let lines = 0;
    for (const e of grid.vertexEdges[v]) if (state[e] === LINE) lines++;
    if (lines > 2) { badVertices.push(v); degreeOk = false; }
    else if (lines === 1) degreeOk = false;
  }
  for (let e = 0; e < grid.edgeCount; e++) if (state[e] === LINE) lineCount++;

  const closed = lineCount > 0 && degreeOk && isOneComponent(grid, state, lineCount);
  return {
    satisfied,
    total,
    badCells,
    badVertices,
    solved: closed && cluesOk,
    closedButWrong: closed && !cluesOk,
  };
}

function isOneComponent(grid, state, lineCount) {
  let start = -1;
  for (let e = 0; e < grid.edgeCount; e++) if (state[e] === LINE) { start = e; break; }
  if (start < 0) return false;
  const seen = new Uint8Array(grid.edgeCount);
  const stack = [start];
  seen[start] = 1;
  let visited = 0;
  while (stack.length) {
    const e = stack.pop();
    visited++;
    for (let k = 0; k < 2; k++) {
      for (const ne of grid.vertexEdges[grid.edgeEnds[e * 2 + k]]) {
        if (state[ne] === LINE && !seen[ne]) { seen[ne] = 1; stack.push(ne); }
      }
    }
  }
  return visited === lineCount;
}

/**
 * 線を引いた結果として自動的に × を付けられる辺を返す。
 * 「数字がそろったマスの残り」と「線が 2 本になった交点の残り」のみ。
 */
export function autoCrossEdges(grid, clues, state, changedEdges) {
  const result = [];
  const cells = new Set();
  const vertices = new Set();
  for (const e of changedEdges) {
    for (const cell of grid.edgeCells[e]) cells.add(cell);
    vertices.add(grid.edgeEnds[e * 2]);
    vertices.add(grid.edgeEnds[e * 2 + 1]);
  }
  for (const cell of cells) {
    const clue = clues[cell];
    if (clue < 0) continue;
    let lines = 0;
    for (let k = 0; k < 4; k++) if (state[grid.cellEdges[cell * 4 + k]] === LINE) lines++;
    if (lines !== clue) continue;
    for (let k = 0; k < 4; k++) {
      const e = grid.cellEdges[cell * 4 + k];
      if (state[e] === UNKNOWN) result.push(e);
    }
  }
  for (const v of vertices) {
    let lines = 0;
    for (const e of grid.vertexEdges[v]) if (state[e] === LINE) lines++;
    if (lines !== 2) continue;
    for (const e of grid.vertexEdges[v]) if (state[e] === UNKNOWN) result.push(e);
  }
  return [...new Set(result)];
}

// 盤面だけで決まる手が複数あるとき、先に示したい順 (人にとって分かりやすい順)
const RULE_PRIORITY = [
  'clue_full', 'clue_rest', 'vertex_two', 'vertex_pair', 'vertex_dead',
  'loop_closed', 'loop_done',
];

const RULE_TITLES = {
  clue_full: '数字がそろった',
  clue_rest: '数字に届かせる',
  vertex_two: '交点に線は 2 本まで',
  vertex_pair: '線の端はつながる',
  vertex_dead: '行き止まりは作れない',
  loop_closed: '小さな輪は閉じられない',
  loop_done: '輪が完成している',
};

/** マスや交点の位置を「3行2列のマス」のように行・列で短く言い表す。 */
function cellName(grid, cell) {
  return `${Math.floor(cell / grid.cols) + 1}行${(cell % grid.cols) + 1}列のマス`;
}

function vertexName(grid, vertex) {
  return `${Math.floor(vertex / (grid.cols + 1)) + 1}行${(vertex % (grid.cols + 1)) + 1}列の点`;
}

/** マスの周囲がいまどうなっているかを数える。 */
function cellCounts(grid, state, cell) {
  let line = 0;
  let cross = 0;
  let unknown = 0;
  for (let k = 0; k < 4; k++) {
    const v = state[grid.cellEdges[cell * 4 + k]];
    if (v === LINE) line++;
    else if (v === CROSS) cross++;
    else unknown++;
  }
  return { line, cross, unknown };
}

/** 矛盾した場所を言葉にする (背理法の説明用)。 */
function clashText(grid, clues, clash) {
  if (!clash) return 'ほかの場所でつじつまが合わなくなります';
  if (clash.kind === 'cell') {
    const clue = clues[clash.index];
    const where = cellName(grid, clash.index);
    return clash.line > clue
      ? `${where}の ${clue} に線が ${clash.line} 本集まります`
      : `${where}の ${clue} に線を ${clash.line + clash.unknown} 本しか引けません`;
  }
  if (clash.kind === 'vertex') {
    const where = vertexName(grid, clash.index);
    return clash.dead
      ? `${where}が行き止まりになります`
      : `${where}に線が ${clash.line} 本集まります`;
  }
  return '輪がひとつにまとまらなくなります';
}

/* ---------------- 証明を言葉にする ---------------- */

/** 手順の中で使う短い呼び名。「3行2列のマス」のように行・列で言う。 */
function cellShort(grid, cell) {
  return `${Math.floor(cell / grid.cols) + 1}行${(cell % grid.cols) + 1}列のマス`;
}

function vertexShort(grid, v) {
  return `${Math.floor(v / (grid.cols + 1)) + 1}行${(v % (grid.cols + 1)) + 1}列の点`;
}

/** 辺は、となりのマスの上下左右で言い表す。 */
export function edgeName(grid, edge) {
  const { dir, r, c } = grid.edgeInfo[edge];
  if (dir === 'h') {
    return r < grid.rows
      ? `${r + 1}行${c + 1}列のマスの上の辺`
      : `${r}行${c + 1}列のマスの下の辺`;
  }
  return c < grid.cols
    ? `${r + 1}行${c + 1}列のマスの左の辺`
    : `${r + 1}行${c}列のマスの右の辺`;
}

const markName = (value) => (value === LINE ? '線' : '×');

/** 輪が答えになれない理由（輪の外の線か、合わない数字）。 */
function witnessText(grid, clues, witness) {
  if (!witness) return 'ほかに満たすべきものが残っています';
  if (witness.edge != null) return `輪の外の${edgeName(grid, witness.edge)}にも線があります`;
  return `${cellShort(grid, witness.cell)}の ${clues[witness.cell]} が満たせません（輪だけだと ${witness.count} 本）`;
}

/** 1 手（同じ理由でまとめて決まる手はひとまとめ）を 1 行にする。 */
function stepLine(grid, clues, group) {
  const step = group[0];
  const n = group.length;
  const target = n === 1 ? edgeName(grid, step.edge) : `残りの ${n} 辺`;
  const mark = markName(step.value);
  switch (step.rule) {
    case 'clue_full':
      return `${cellShort(grid, step.cell)}の ${clues[step.cell]} は線が ${clues[step.cell]} 本そろった → ${target}は ${mark}`;
    case 'clue_rest':
      return `${cellShort(grid, step.cell)}の ${clues[step.cell]} は × が ${4 - clues[step.cell]} 本 → ${target}は ${mark}`;
    case 'vertex_two':
      return `${vertexShort(grid, step.vertex)}に線が 2 本集まった → ${target}は ${mark}`;
    case 'vertex_pair':
      return `${vertexShort(grid, step.vertex)}は線の端で、ほかの道は × → ${target}は ${mark}`;
    case 'vertex_dead':
      return `${vertexShort(grid, step.vertex)}はほかの道がすべて ×（線を引くと行き止まり） → ${target}は ${mark}`;
    case 'loop_closed':
      return `${target}を線にすると輪が閉じるが、${witnessText(grid, clues, step.witness)} → ${target}は ${mark}`;
    case 'loop_done':
      return `輪が完成して数字もすべて満たされた → ${target}は ${mark}`;
    default:
      return `${target}は ${mark}`;
  }
}

/** 矛盾を短く言う（手順の最後の行）。 */
function clashLine(grid, clues, clash) {
  if (clash.kind === 'cell') {
    const clue = clues[clash.index];
    return clash.line > clue
      ? `${cellShort(grid, clash.index)}の ${clue} のまわりに線が ${clash.line} 本になる`
      : `${cellShort(grid, clash.index)}の ${clue} のまわりに線を ${clash.line + clash.unknown} 本しか引けない`;
  }
  if (clash.kind === 'vertex') {
    return clash.dead
      ? `${vertexShort(grid, clash.index)}が行き止まりになる`
      : `${vertexShort(grid, clash.index)}に線が ${clash.line} 本集まる`;
  }
  if (clash.kind === 'loop') return `輪が閉じてしまうが、${witnessText(grid, clues, clash.witness)}`;
  if (clash.kind === 'conflict') {
    return `${edgeName(grid, clash.edge)}が ${markName(opposite(clash.value))} なのに、${stepLine(grid, clues, [{ edge: clash.edge, value: clash.value, ...clash.reason }])}`;
  }
  return 'つじつまが合わなくなる';
}

const opposite = (value) => (value === LINE ? CROSS : LINE);

/**
 * 背理法の証明を、字下げつきの手順の列にする。
 * @returns {{text:string, level:number, kind:string}[]}
 */
export function proofLines(grid, clues, proof, level = 0) {
  const lines = [{
    kind: 'assume',
    level,
    text: `${edgeName(grid, proof.edge)}を ${markName(proof.assume)} と仮定する`,
  }];
  let group = [];
  const flush = () => {
    if (group.length) lines.push({ kind: 'step', level, text: stepLine(grid, clues, group) });
    group = [];
  };
  for (const step of proof.steps) {
    if (step.rule === 'case') {
      flush();
      lines.push({
        kind: 'case',
        level,
        text: `${edgeName(grid, step.edge)}は ${markName(step.value)}（逆を仮定すると矛盾する。理由は次のとおり）`,
      });
      lines.push(...proofLines(grid, clues, step.sub, level + 1));
      continue;
    }
    const prev = group[0];
    const same = prev && prev.rule === step.rule && prev.value === step.value
      && prev.cell === step.cell && prev.vertex === step.vertex
      && (step.rule.startsWith('clue') || step.rule.startsWith('vertex'));
    if (!same) flush();
    group.push(step);
  }
  flush();
  lines.push({ kind: 'clash', level, text: `矛盾: ${clashLine(grid, clues, proof.clash)}` });
  return lines;
}

/** 証明の中で根拠になっている場所（ハイライト用）を集める。 */
function proofFocus(grid, proof, focus = { cells: [], vertices: [], edges: [], trial: [] }, top = true) {
  if (top) focus.edges.push(...proof.uses);
  focus.trial.push({ edge: proof.edge, value: proof.assume });
  const addClash = (clash) => {
    if (clash.kind === 'cell') focus.cells.push(clash.index);
    if (clash.kind === 'vertex') focus.vertices.push(clash.index);
    if (clash.kind === 'loop' && clash.witness?.cell != null) focus.cells.push(clash.witness.cell);
  };
  for (const step of proof.steps) {
    if (step.rule === 'case') proofFocus(grid, step.sub, focus, false);
    focus.trial.push({ edge: step.edge, value: step.value });
  }
  if (top) {
    addClash(proof.clash);
    // 同じ辺が入れ子の仮定で何度も出てくるときは、外側の値を残す
    const seen = new Map();
    for (const t of focus.trial) if (!seen.has(t.edge)) seen.set(t.edge, t);
    seen.delete(proof.edge);
    focus.trial = [...seen.values()];
    focus.cells = [...new Set(focus.cells)];
    focus.vertices = [...new Set(focus.vertices)];
  }
  return focus;
}

/**
 * その一手が決まる理由を、いまの盤面の数字や本数を使って説明する。
 * @returns {{title:string, text:string, focus:{cells:number[], vertices:number[], edges:number[]}}}
 */
function explain(grid, clues, state, edge, value, reason) {
  const rule = reason.rule;
  const focus = { cells: [], vertices: [], edges: [] };
  let text = 'ここは論理的に決まります。';

  if ((rule === 'clue_full' || rule === 'clue_rest') && reason.cell != null) {
    const cell = reason.cell;
    const clue = clues[cell];
    const { line, unknown } = cellCounts(grid, state, cell);
    focus.cells.push(cell);
    focus.edges.push(...reason.premises);
    if (rule === 'clue_rest') {
      text = `${cellName(grid, cell)}の ${clue} は線が ${line} 本、空きが ${unknown} 辺。空きを全部線にしないと ${clue} 本に届きません。`;
    } else if (clue === 0) {
      text = `${cellName(grid, cell)}は 0。まわりの 4 辺はすべて × です。`;
    } else {
      text = `${cellName(grid, cell)}の ${clue} は線が ${line} 本そろいました。残りの辺は × です。`;
    }
  } else if (rule.startsWith('vertex') && reason.vertex != null) {
    const v = reason.vertex;
    focus.vertices.push(v);
    focus.edges.push(...reason.premises);
    if (rule === 'vertex_two') {
      text = `${vertexName(grid, v)}に線が 2 本集まりました。3 本目を引くと分かれ道になります。`;
    } else if (rule === 'vertex_pair') {
      text = `${vertexName(grid, v)}は線の端で、ほかの道は ×。進めるのはここだけです。`;
    } else {
      text = `${vertexName(grid, v)}はほかの道がすべて ×。ここに線を引くと行き止まりになります。`;
    }
  } else if (rule === 'loop_closed') {
    focus.edges.push(...reason.premises);
    if (reason.witness?.cell != null) focus.cells.push(reason.witness.cell);
    text = `ここに線を引くと輪が閉じますが、${witnessText(grid, clues, reason.witness)}。輪はひとつだけなので引けません。`;
  } else if (rule === 'loop_done') {
    focus.edges.push(...reason.premises);
    text = '輪が完成し、数字もすべて満たされました。残りの辺は × です。';
  }

  return { title: RULE_TITLES[rule] || 'ここが決まります', text, focus };
}

/** 背理法の証明の要約と見出し。 */
function explainContradiction(grid, clues, proof) {
  const assumed = markName(proof.assume);
  const mark = markName(proof.value);
  const nested = proof.steps.some((s) => s.rule === 'case');
  const lines = proofLines(grid, clues, proof);
  const count = lines.filter((l) => l.level === 0 && l.kind !== 'assume' && l.kind !== 'clash').length;
  // 手順は畳んであるので、要約には何が起きて矛盾するかも書いておく
  const why = `（${clashLine(grid, clues, proof.clash)}）`;
  const text = `ためしに${assumed}にすると、${count === 0 ? 'すぐ' : `${count} 手で`}矛盾します${why}。だから ${mark} です。`;
  return {
    title: nested ? '仮定を重ねると矛盾する' : '逆を試すと矛盾する',
    text,
    lines,
    focus: proofFocus(grid, proof),
  };
}

const ruleRank = (proof) => {
  const rank = RULE_PRIORITY.indexOf(proof.step.rule);
  return rank < 0 ? RULE_PRIORITY.length : rank;
};

/** 証明 1 つをヒントの形にする。 */
function hintFromProof(grid, clues, state, proof) {
  if (proof.kind === 'direct') {
    const { title, text, focus } = explain(grid, clues, state, proof.edge, proof.value, proof.step);
    return { type: 'move', edge: proof.edge, value: proof.value, title, message: text, steps: [], proof, focus };
  }
  const { title, text, lines, focus } = explainContradiction(grid, clues, proof);
  return { type: 'move', edge: proof.edge, value: proof.value, title, message: text, steps: lines, proof, focus };
}

/** 分かりやすさの点数（小さいほど先に見せる）。 */
const proofScore = (proof) => (proof.kind === 'direct' ? ruleRank(proof) : 100 + proofSize(proof));

/**
 * 同じ理由で決まる手は 1 つにまとめる（0 のまわり 4 辺が 4 枚に分かれないように）。
 * 背理法は辺ごとに別の手として扱う。
 */
function reasonKey(proof) {
  if (proof.kind !== 'direct') return `edge:${proof.edge}`;
  const { rule, cell, vertex } = proof.step;
  if (cell != null) return `${rule}:cell:${cell}`;
  if (vertex != null) return `${rule}:vertex:${vertex}`;
  return `${rule}:edge:${proof.edge}`;
}

/**
 * いま示せるヒントを、分かりやすい順に並べて返す（ヒントのページ送り用）。
 * どの手にも、いまの盤面から一歩ずつたどれる証明が付いていて、checkProof で検算済み。
 * 間違いや矛盾があるとき、決まる手が無いときは、その 1 件だけを返す。
 * @param {number} [limit=10] 返す件数の上限
 * @returns {object[]} findHint と同じ形のヒントの列（1 件以上）
 */
export function findHints(grid, clues, state, solution, limit = 10) {
  if (solution) {
    for (let e = 0; e < grid.edgeCount; e++) {
      if (state[e] === UNKNOWN) continue;
      if (state[e] !== solution[e]) {
        return [{
          type: 'mistake',
          edge: e,
          value: solution[e],
          title: '間違いがあります',
          message: state[e] === LINE
            ? 'ここに線は通りません。先にこの線を消してください。'
            : 'ここには線が通ります。先に × を外してください。',
          focus: { cells: [], vertices: [], edges: [] },
        }];
      }
    }
  }

  const check = solveLogical(grid, clues, { maxDepth: 0, initial: state });
  if (check.status === 'contradiction') {
    return [{
      type: 'mistake',
      title: '盤面が矛盾しています',
      message: `いまの盤面では${clashText(grid, clues, check.state.clash)}。どこかに誤りがあります。`,
      focus: { cells: [], vertices: [], edges: [] },
    }];
  }

  const proofs = collectProofs(grid, clues, state, { solution })
    .map((proof, i) => ({ proof, i, score: proofScore(proof) }))
    .sort((a, b) => a.score - b.score || a.i - b.i);
  const seen = new Set();
  const hints = [];
  for (const { proof } of proofs) {
    const key = reasonKey(proof);
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push(hintFromProof(grid, clues, state, proof));
    if (hints.length >= limit) break;
  }
  if (hints.length) return hints;
  return [{
    type: 'none',
    title: 'ヒントはありません',
    message: state.includes(UNKNOWN)
      ? 'いまの盤面から、根拠を示して決められる場所が見つかりませんでした。'
      : 'もう全部の辺が埋まっています。',
    focus: { cells: [], vertices: [], edges: [] },
  }];
}

/**
 * 次の一手を 1 つ探す（いちばん分かりやすいもの）。
 * @returns {{type:'mistake'|'move'|'none', edge?:number, value?:number,
 *            title:string, message:string, steps?:object[], proof?:object, focus?:object}}
 */
export function findHint(grid, clues, state, solution) {
  return findHints(grid, clues, state, solution, 1)[0];
}
