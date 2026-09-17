/**
 * スリザーリンクの盤面ジオメトリ。
 *
 * 辺は 1 本の通し番号で管理する。
 *   水平辺 H(r, c)  : r = 0..rows,   c = 0..cols-1  → index = r * cols + c
 *   垂直辺 V(r, c)  : r = 0..rows-1, c = 0..cols    → index = hCount + r * (cols + 1) + c
 * 頂点は vtx(r, c) = r * (cols + 1) + c (r = 0..rows, c = 0..cols)。
 * マスは cell(r, c) = r * cols + c。
 */

export const UNKNOWN = 0;
export const LINE = 1;
export const CROSS = 2;

export function createGrid(rows, cols) {
  const hCount = (rows + 1) * cols;
  const vCount = rows * (cols + 1);
  const edgeCount = hCount + vCount;
  const vertexCount = (rows + 1) * (cols + 1);
  const cellCount = rows * cols;

  const h = (r, c) => r * cols + c;
  const v = (r, c) => hCount + r * (cols + 1) + c;
  const vtx = (r, c) => r * (cols + 1) + c;

  // 辺 → 両端の頂点
  const edgeEnds = new Int32Array(edgeCount * 2);
  // 辺 → 座標情報 (描画・ヒント表示用)
  const edgeInfo = new Array(edgeCount);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = h(r, c);
      edgeEnds[e * 2] = vtx(r, c);
      edgeEnds[e * 2 + 1] = vtx(r, c + 1);
      edgeInfo[e] = { index: e, dir: 'h', r, c };
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const e = v(r, c);
      edgeEnds[e * 2] = vtx(r, c);
      edgeEnds[e * 2 + 1] = vtx(r + 1, c);
      edgeInfo[e] = { index: e, dir: 'v', r, c };
    }
  }

  // マス → 周囲 4 辺 (上・下・左・右)
  const cellEdges = new Int32Array(cellCount * 4);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 4;
      cellEdges[i] = h(r, c);
      cellEdges[i + 1] = h(r + 1, c);
      cellEdges[i + 2] = v(r, c);
      cellEdges[i + 3] = v(r, c + 1);
    }
  }

  // 辺 → 接するマス (1 個または 2 個)
  const edgeCells = new Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) edgeCells[e] = [];
  for (let cell = 0; cell < cellCount; cell++) {
    for (let k = 0; k < 4; k++) edgeCells[cellEdges[cell * 4 + k]].push(cell);
  }

  // 頂点 → 接続する辺 (2〜4 本)
  const vertexEdges = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) vertexEdges[i] = [];
  for (let e = 0; e < edgeCount; e++) {
    vertexEdges[edgeEnds[e * 2]].push(e);
    vertexEdges[edgeEnds[e * 2 + 1]].push(e);
  }

  return {
    rows,
    cols,
    hCount,
    vCount,
    edgeCount,
    vertexCount,
    cellCount,
    h,
    v,
    vtx,
    edgeEnds,
    edgeInfo,
    cellEdges,
    edgeCells,
    vertexEdges,
    cellAt: (r, c) => r * cols + c,
  };
}

const gridCache = new Map();

/** 同じサイズの Grid を使い回す (生成器が何度も呼ぶため)。 */
export function getGrid(rows, cols) {
  const key = rows + 'x' + cols;
  let g = gridCache.get(key);
  if (!g) {
    g = createGrid(rows, cols);
    gridCache.set(key, g);
  }
  return g;
}

/**
 * 「内側マスの集合」から、その境界となる辺の集合を求める。
 * @param {Uint8Array} inside 長さ rows*cols。1 なら内側。
 * @returns {Uint8Array} 長さ edgeCount。1 なら線。
 */
export function boundaryEdges(grid, inside) {
  const { rows, cols, edgeCount, cellEdges } = grid;
  const edges = new Uint8Array(edgeCount);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!inside[r * cols + c]) continue;
      const base = (r * cols + c) * 4;
      // 上
      if (r === 0 || !inside[(r - 1) * cols + c]) edges[cellEdges[base]] ^= 1;
      // 下
      if (r === rows - 1 || !inside[(r + 1) * cols + c]) edges[cellEdges[base + 1]] ^= 1;
      // 左
      if (c === 0 || !inside[r * cols + c - 1]) edges[cellEdges[base + 2]] ^= 1;
      // 右
      if (c === cols - 1 || !inside[r * cols + c + 1]) edges[cellEdges[base + 3]] ^= 1;
    }
  }
  return edges;
}

/** 線の集合がちょうど 1 本の閉ループになっているか。 */
export function isSingleLoop(grid, edges) {
  const { edgeCount, vertexCount, edgeEnds, vertexEdges } = grid;
  const degree = new Int32Array(vertexCount);
  let lineCount = 0;
  for (let e = 0; e < edgeCount; e++) {
    if (edges[e] !== 1) continue;
    lineCount++;
    degree[edgeEnds[e * 2]]++;
    degree[edgeEnds[e * 2 + 1]]++;
  }
  if (lineCount === 0) return false;
  for (let v = 0; v < vertexCount; v++) {
    if (degree[v] !== 0 && degree[v] !== 2) return false;
  }
  // 連結性: 線の辺が 1 つの連結成分か
  let start = -1;
  for (let e = 0; e < edgeCount; e++) {
    if (edges[e] === 1) { start = e; break; }
  }
  const seen = new Uint8Array(edgeCount);
  const stack = [start];
  seen[start] = 1;
  let visited = 0;
  while (stack.length) {
    const e = stack.pop();
    visited++;
    for (let k = 0; k < 2; k++) {
      const vtx = edgeEnds[e * 2 + k];
      for (const ne of vertexEdges[vtx]) {
        if (edges[ne] === 1 && !seen[ne]) {
          seen[ne] = 1;
          stack.push(ne);
        }
      }
    }
  }
  return visited === lineCount;
}

/** 線の集合からマスごとの数字 (0〜4) を求める。 */
export function cluesFromEdges(grid, edges) {
  const { rows, cols, cellEdges } = grid;
  const clues = new Int8Array(rows * cols);
  for (let cell = 0; cell < rows * cols; cell++) {
    let n = 0;
    for (let k = 0; k < 4; k++) if (edges[cellEdges[cell * 4 + k]] === 1) n++;
    clues[cell] = n;
  }
  return clues;
}
