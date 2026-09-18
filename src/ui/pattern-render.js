/**
 * 定石の図を SVG で描く。
 * もとから分かっていること（黒）と、そこから確定すること（強調色）を
 * 塗り分けるのがこの図の役目。
 */

import { getGrid, LINE, CROSS } from '../core/grid.js';
import { buildPattern } from '../core/patterns.js';

const NS = 'http://www.w3.org/2000/svg';
const PAD = 0.6;

const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

function endpoints(info) {
  return info.dir === 'h'
    ? [info.c, info.r, info.c + 1, info.r]
    : [info.c, info.r, info.c, info.r + 1];
}

function drawLine(parent, info, cls) {
  const [x1, y1, x2, y2] = endpoints(info);
  parent.appendChild(el('line', { class: cls, x1, y1, x2, y2 }));
}

function drawCross(parent, info, cls) {
  const [x1, y1, x2, y2] = endpoints(info);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const s = 0.11;
  parent.appendChild(el('path', {
    class: cls,
    d: `M${mx - s} ${my - s}L${mx + s} ${my + s}M${mx + s} ${my - s}L${mx - s} ${my + s}`,
  }));
}

function drawHighlight(parent, info) {
  const [x1, y1, x2, y2] = endpoints(info);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const long = 0.78;
  const short = 0.34;
  const w = info.dir === 'h' ? long : short;
  const h = info.dir === 'h' ? short : long;
  parent.appendChild(el('rect', {
    class: 'pat-halo',
    x: mx - w / 2, y: my - h / 2, width: w, height: h, rx: 0.16,
  }));
}

/**
 * 1 つの定石を描いた <svg> を返す。
 * @param {object} pattern PATTERNS の 1 要素
 */
export function renderPattern(pattern) {
  const { grid, clues, given, conclude } = buildPattern(pattern);
  const { rows, cols } = pattern;

  const svg = el('svg', {
    xmlns: NS,
    class: 'pat-svg',
    viewBox: `${-PAD} ${-PAD} ${cols + PAD * 2} ${rows + PAD * 2}`,
    role: 'img',
    'aria-label': `${pattern.title} の図`,
  });

  const halos = el('g');
  const marks = el('g');
  const dots = el('g');
  const texts = el('g');
  svg.append(halos, marks, dots, texts);

  // 確定する場所の下地
  const concluded = new Map();
  for (const { edge, value } of conclude) {
    concluded.set(edge, value);
    drawHighlight(halos, grid.edgeInfo[edge]);
  }

  // 最初から分かっている印
  for (let e = 0; e < grid.edgeCount; e++) {
    if (given[e] === LINE) drawLine(marks, grid.edgeInfo[e], 'pat-line');
    else if (given[e] === CROSS) drawCross(marks, grid.edgeInfo[e], 'pat-cross');
  }

  // 確定する印
  for (const [edge, value] of concluded) {
    if (value === LINE) drawLine(marks, grid.edgeInfo[edge], 'pat-line is-new');
    else drawCross(marks, grid.edgeInfo[edge], 'pat-cross is-new');
  }

  // 点
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      dots.appendChild(el('circle', { class: 'pat-dot', cx: c, cy: r, r: 0.062 }));
    }
  }

  // 数字
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const clue = clues[r * cols + c];
      if (clue < 0) continue;
      const t = el('text', {
        class: 'pat-clue',
        x: c + 0.5,
        y: r + 0.5,
        'dominant-baseline': 'central',
      });
      t.textContent = String(clue);
      texts.appendChild(t);
    }
  }

  return svg;
}

/** 凡例に使う小さな見本。 */
export function renderSwatch(kind) {
  const svg = el('svg', { xmlns: NS, class: 'pat-swatch', viewBox: '-0.1 -0.35 1.2 0.7' });
  const info = { dir: 'h', r: 0, c: 0 };
  if (kind === 'new-line') { drawHighlight(svg, info); drawLine(svg, info, 'pat-line is-new'); }
  else if (kind === 'new-cross') { drawHighlight(svg, info); drawCross(svg, info, 'pat-cross is-new'); }
  else if (kind === 'line') drawLine(svg, info, 'pat-line');
  else drawCross(svg, info, 'pat-cross');
  svg.append(
    el('circle', { class: 'pat-dot', cx: 0, cy: 0, r: 0.07 }),
    el('circle', { class: 'pat-dot', cx: 1, cy: 0, r: 0.07 }),
  );
  return svg;
}

export { getGrid };
