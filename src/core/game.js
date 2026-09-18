/**
 * 遊んでいる最中の判定まわり。UI から切り離してテストできるようにしている。
 */

import { UNKNOWN, LINE, CROSS } from './grid.js';
import { solveLogical, RULE_LABELS } from './solver.js';

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

// ヒントとして提示したい推論の順番 (人にとって分かりやすい順)
const RULE_PRIORITY = [
  'clue_full', 'clue_rest', 'vertex_two', 'vertex_pair', 'vertex_dead',
  'loop_closed', 'loop_done', 'assume_line', 'assume_cross',
];

const RULE_TITLES = {
  clue_full: '数字がそろった',
  clue_rest: '数字に届かせる',
  vertex_two: '交点に線は 2 本まで',
  vertex_pair: '線の端はつながる',
  vertex_dead: '行き止まりは作れない',
  loop_closed: '小さな輪は閉じられない',
  loop_done: '輪が完成している',
  assume_line: '逆を試すと矛盾する',
  assume_cross: '逆を試すと矛盾する',
};

/** マスや交点の位置を「上から◯番目・左から◯番目」と言い表す。 */
function cellName(grid, cell) {
  const r = Math.floor(cell / grid.cols);
  const c = cell % grid.cols;
  return `上から ${r + 1} 番目・左から ${c + 1} 番目のマス`;
}

function vertexName(grid, vertex) {
  const r = Math.floor(vertex / (grid.cols + 1));
  const c = vertex % (grid.cols + 1);
  return `上から ${r + 1} 番目・左から ${c + 1} 番目の点`;
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

function vertexCounts(grid, state, vertex) {
  let line = 0;
  let cross = 0;
  let unknown = 0;
  for (const e of grid.vertexEdges[vertex]) {
    if (state[e] === LINE) line++;
    else if (state[e] === CROSS) cross++;
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
      ? `${where}の ${clue} のまわりに線が ${clash.line} 本も集まってしまいます`
      : `${where}の ${clue} のまわりには、線を ${clash.line + clash.unknown} 本しか引けなくなります（${clue} 本必要なのに）`;
  }
  if (clash.kind === 'vertex') {
    const where = vertexName(grid, clash.index);
    return clash.dead
      ? `${where}が行き止まりになってしまいます`
      : `${where}に線が ${clash.line} 本集まってしまいます`;
  }
  return '輪がひとつにまとまらなくなります';
}

/**
 * その一手が決まる理由を、いまの盤面の数字や本数を使って説明する。
 * @returns {{title:string, text:string, focus:{cells:number[], vertices:number[], edges:number[]}}}
 */
function explain(grid, clues, state, edge, value, reason) {
  const rule = reason.rule;
  const mark = value === LINE ? '線' : '×';
  const focus = { cells: [], vertices: [], edges: [] };
  let text = 'ここは論理的に決まります。';

  if ((rule === 'clue_full' || rule === 'clue_rest') && reason.cell != null) {
    const cell = reason.cell;
    const clue = clues[cell];
    const { line, unknown } = cellCounts(grid, state, cell);
    focus.cells.push(cell);
    for (let k = 0; k < 4; k++) {
      const e = grid.cellEdges[cell * 4 + k];
      if (state[e] !== UNKNOWN) focus.edges.push(e);
    }
    if (rule === 'clue_rest') {
      text = `${cellName(grid, cell)}の ${clue} は、いま線が ${line} 本、空いているのが ${unknown} 辺だけ。空いている辺を全部使わないと ${clue} 本に届きません。`;
    } else if (clue === 0) {
      text = `${cellName(grid, cell)}は 0。線を 1 本も通さないマスなので、まわりの 4 辺はすべて × です。`;
    } else {
      text = `${cellName(grid, cell)}の ${clue} は、まわりにもう線が ${line} 本。必要な数がそろっているので、残りの辺にはもう引けません。`;
    }
  } else if (rule.startsWith('vertex') && reason.vertex != null) {
    const v = reason.vertex;
    const { line, unknown } = vertexCounts(grid, state, v);
    focus.vertices.push(v);
    for (const e of grid.vertexEdges[v]) if (state[e] !== UNKNOWN) focus.edges.push(e);
    if (rule === 'vertex_two') {
      text = `${vertexName(grid, v)}には、もう線が 2 本集まっています。交点の線は 0 本か 2 本なので、3 本目は引けません。`;
    } else if (rule === 'vertex_pair') {
      text = `${vertexName(grid, v)}は線の端で、ほかの道はすべて ×。輪は行き止まりを作れないので、進めるのはここだけです。`;
    } else {
      text = `${vertexName(grid, v)}は、この辺のほかがすべて ×。ここに線を引くと、その点から線が 1 本だけ出る行き止まりになってしまいます。`;
    }
  } else if (rule === 'loop_closed') {
    text = 'ここに線を引くと輪が閉じてしまいますが、まだ満たしていない数字が残っています。答えはひとつながりの輪ひとつだけなので、ここは引けません。';
  } else if (rule === 'loop_done') {
    text = 'すでに輪が完成し、数字もすべて満たされています。残りの辺はもう線にできません。';
  } else if (rule === 'assume_line' || rule === 'assume_cross') {
    const assumed = rule === 'assume_line' ? '線' : '×';
    text = `ためしにここを${assumed}だとしてみると、${clashText(grid, clues, reason.clash)}。だからここは ${mark} で確定です。`;
    if (reason.clash && reason.clash.kind === 'cell') focus.cells.push(reason.clash.index);
    if (reason.clash && reason.clash.kind === 'vertex') focus.vertices.push(reason.clash.index);
  }

  return { title: RULE_TITLES[rule] || 'ここが決まります', text, focus };
}

/**
 * その理由が「いま見えている盤面」だけで通るかを確かめる。
 * ソルバは途中で導いた情報を使って先へ進むので、そのまま説明すると
 * 盤面と数字が合わなくなる。ここで足切りして、その場で納得できる手だけを選ぶ。
 * @returns {object|null} 通るなら理由（背理法はその場で取り直した矛盾つき）、通らなければ null
 */
function justifiedNow(grid, clues, state, edge, value, reason) {
  const rule = reason.rule;

  if (rule === 'clue_full' || rule === 'clue_rest') {
    const cell = reason.cell;
    if (cell == null) return null;
    const clue = clues[cell];
    const { line, unknown } = cellCounts(grid, state, cell);
    if (unknown === 0) return null;
    if (rule === 'clue_full') return line === clue ? reason : null;
    return line + unknown === clue ? reason : null;
  }

  if (rule.startsWith('vertex')) {
    const v = reason.vertex;
    if (v == null) return null;
    const { line, unknown } = vertexCounts(grid, state, v);
    if (rule === 'vertex_two') return line === 2 && unknown > 0 ? reason : null;
    if (rule === 'vertex_pair') return line === 1 && unknown === 1 ? reason : null;
    return line === 0 && unknown === 1 ? reason : null;
  }

  // 輪まわりと背理法は、いまの盤面から実際に置き直して確かめる
  const probe = Int8Array.from(state);
  probe[edge] = value === LINE ? CROSS : LINE;
  for (const depth of [0, 1]) {
    const res = solveLogical(grid, clues, { maxDepth: depth, initial: probe });
    if (res.status === 'contradiction') {
      return { ...reason, clash: res.state.clash, depth };
    }
  }
  return null;
}

/**
 * 次の一手を探す。
 * @returns {{type:'mistake'|'move'|'none', edge?:number, value?:number,
 *            title:string, message:string, focus?:object}}
 */
export function findHint(grid, clues, state, solution) {
  if (solution) {
    for (let e = 0; e < grid.edgeCount; e++) {
      if (state[e] === UNKNOWN) continue;
      if (state[e] !== solution[e]) {
        return {
          type: 'mistake',
          edge: e,
          value: solution[e],
          title: '間違いがあります',
          message: state[e] === LINE
            ? 'ここには線が通りません。先にこの線を消してください。このままだと、この先の推論がすべてずれてしまいます。'
            : 'ここには線が通ります。先に × を外してください。このままだと、この先の推論がすべてずれてしまいます。',
          focus: { cells: [], vertices: [], edges: [] },
        };
      }
    }
  }

  for (const depth of [0, 1, 2]) {
    const res = solveLogical(grid, clues, { maxDepth: depth, initial: state, trackReasons: true });
    if (res.status === 'contradiction') {
      return {
        type: 'mistake',
        title: '盤面が矛盾しています',
        message: `いまの盤面では${clashText(grid, clues, res.state.clash)}。どこかに誤りがあります。チェックを使ってみてください。`,
        focus: { cells: [], vertices: [], edges: [] },
      };
    }
    // いまの盤面だけで説明できる手を集め、分かりやすい順に選ぶ
    const candidates = [];
    for (let e = 0; e < grid.edgeCount; e++) {
      if (state[e] !== UNKNOWN) continue;
      const decided = res.state.edges[e];
      if (decided === UNKNOWN) continue;
      const reason = res.state.reasons[e] || { rule: 'assume_line' };
      const rank = RULE_PRIORITY.indexOf(reason.rule);
      candidates.push({ edge: e, value: decided, reason, score: rank < 0 ? RULE_PRIORITY.length : rank });
    }
    candidates.sort((a, b) => a.score - b.score);

    for (const c of candidates) {
      const reason = justifiedNow(grid, clues, state, c.edge, c.value, c.reason);
      if (!reason) continue;
      const { title, text, focus } = explain(grid, clues, state, c.edge, c.value, reason);
      return { type: 'move', edge: c.edge, value: c.value, title, message: text, focus };
    }
  }
  return {
    type: 'none',
    title: 'ヒントはありません',
    message: 'これ以上、いまの盤面から論理的に決まる場所はありません。もう完成しているかもしれません。',
    focus: { cells: [], vertices: [], edges: [] },
  };
}
