/**
 * 「遊び方」の図。点・線・×・数字を、定石の図と同じ見た目（pat-*）で小さく描く。
 * 図はすべてここで組み立てるので、index.html には置き場所（data-fig）だけを書く。
 */

const NS = 'http://www.w3.org/2000/svg';
const PAD = 0.45;

const svgEl = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

/** ['h', r, c] は (r, c) の点から右へ、['v', r, c] は下へ伸びる辺。 */
const ends = ([dir, r, c]) => (dir === 'h' ? [c, r, c + 1, r] : [c, r, c, r + 1]);

/** inside のマス（"r,c"）の外周を、1 本の輪の辺として返す。 */
function loopAround(rows, cols, inside) {
  const isIn = (r, c) => inside.has(`${r},${c}`);
  const lines = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) if (isIn(r - 1, c) !== isIn(r, c)) lines.push(['h', r, c]);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) if (isIn(r, c - 1) !== isIn(r, c)) lines.push(['v', r, c]);
  }
  return lines;
}

/** マスのまわりに引かれた線の本数（数字の答え）。 */
function countAround(lines, r, c) {
  const key = (e) => e.join(',');
  const set = new Set(lines.map(key));
  return [['h', r, c], ['h', r + 1, c], ['v', r, c], ['v', r, c + 1]].filter((e) => set.has(key(e))).length;
}

/**
 * 小さな盤を描く。
 * @param {object} o rows, cols, clues（[[r, c, n]]）, lines, crosses, bad（赤い線）, marks（赤い丸を付ける点 [r, c]）, label
 */
function board(o) {
  const { rows, cols } = o;
  const svg = svgEl('svg', {
    class: 'pat-svg help-svg',
    viewBox: `${-PAD} ${-PAD} ${cols + PAD * 2} ${rows + PAD * 2}`,
    role: 'img',
    'aria-label': o.label,
  });
  const g = svgEl('g');
  svg.appendChild(g);
  for (const [r, c] of o.marks ?? []) g.appendChild(svgEl('circle', { class: 'help-ring', cx: c, cy: r, r: 0.26 }));
  for (const e of o.lines ?? []) {
    const [x1, y1, x2, y2] = ends(e);
    g.appendChild(svgEl('line', { class: 'pat-line', x1, y1, x2, y2 }));
  }
  for (const e of o.bad ?? []) {
    const [x1, y1, x2, y2] = ends(e);
    g.appendChild(svgEl('line', { class: 'pat-line help-bad', x1, y1, x2, y2 }));
  }
  for (const e of o.crosses ?? []) {
    const [x1, y1, x2, y2] = ends(e);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const s = 0.11;
    g.appendChild(svgEl('path', { class: 'pat-cross', d: `M${mx - s} ${my - s}L${mx + s} ${my + s}M${mx + s} ${my - s}L${mx - s} ${my + s}` }));
  }
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) g.appendChild(svgEl('circle', { class: 'pat-dot', cx: c, cy: r, r: 0.062 }));
  }
  for (const [r, c, n] of o.clues ?? []) {
    const t = svgEl('text', { class: 'pat-clue', x: c + 0.5, y: r + 0.5, 'dominant-baseline': 'central' });
    t.textContent = String(n);
    g.appendChild(t);
  }
  return svg;
}

/** 図と、その下の短い説明。ok が true なら「○」、false なら「×」の札を付ける。 */
function figure(svg, caption, ok) {
  const f = document.createElement('figure');
  f.className = 'help-fig';
  if (ok != null) {
    const tag = document.createElement('span');
    tag.className = `help-tag ${ok ? 'is-ok' : 'is-ng'}`;
    tag.textContent = ok ? 'OK' : 'NG';
    f.appendChild(tag);
  }
  f.appendChild(svg);
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  f.appendChild(cap);
  return f;
}

const FIGURES = {
  /** 問題と、その答え（輪を 1 本）。 */
  example() {
    const rows = 4;
    const cols = 4;
    const inside = new Set(['0,0', '0,1', '1,1', '2,1', '2,2', '3,2', '1,2']);
    const lines = loopAround(rows, cols, inside);
    const show = [[0, 0], [0, 3], [1, 0], [1, 2], [2, 0], [2, 3], [3, 1], [3, 3]];
    const clues = show.map(([r, c]) => [r, c, countAround(lines, r, c)]);
    return [
      figure(board({ rows, cols, clues, label: '問題の例。点と数字だけが並んでいる' }), '問題', null),
      figure(board({ rows, cols, clues, lines, label: '答えの例。数字に合わせて、ひとつながりの輪が 1 本引かれている' }), '答え：輪が 1 本', null),
    ];
  },

  /** 数字は、まわり 4 辺のうち線の本数。 */
  numbers() {
    const one = (n, lines, crosses) => figure(
      board({ rows: 1, cols: 1, clues: [[0, 0, n]], lines, crosses, label: `数字 ${n} のマス。まわりに線が ${n} 本` }),
      `線が ${n} 本`, null,
    );
    return [
      one(0, [], [['h', 0, 0], ['h', 1, 0], ['v', 0, 0], ['v', 0, 1]]),
      one(1, [['h', 0, 0]], [['h', 1, 0], ['v', 0, 0], ['v', 0, 1]]),
      one(2, [['h', 0, 0], ['v', 0, 0]], [['h', 1, 0], ['v', 0, 1]]),
      one(3, [['h', 0, 0], ['v', 0, 0], ['v', 0, 1]], [['h', 1, 0]]),
    ];
  },

  /** やってはいけない形。 */
  rules() {
    return [
      figure(board({
        rows: 2, cols: 2, label: '枝分かれ。1 つの点から線が 3 本出ている',
        lines: [['h', 1, 0], ['v', 0, 1]], bad: [['h', 1, 1]], marks: [[1, 1]],
      }), '枝分かれ', false),
      figure(board({
        rows: 2, cols: 2, label: '交差。1 つの点で線が十字に交わっている',
        lines: [['h', 1, 0], ['h', 1, 1]], bad: [['v', 0, 1], ['v', 1, 1]], marks: [[1, 1]],
      }), '交差', false),
      figure(board({
        rows: 1, cols: 3, label: '輪が 2 つに分かれている',
        lines: loopAround(1, 3, new Set(['0,0'])), bad: loopAround(1, 3, new Set(['0,2'])),
      }), '輪が 2 つ', false),
      figure(board({
        rows: 2, cols: 2, label: '途切れ。線の端が行き止まりになっている',
        lines: [['h', 0, 0], ['v', 0, 0], ['v', 1, 0], ['h', 2, 0]], marks: [[0, 1], [2, 1]],
      }), '途切れ', false),
    ];
  },

  /** タップで印が変わる順番（線モード）。 */
  tap() {
    const step = (kind, caption) => figure(board({
      rows: 0, cols: 1, label: caption,
      lines: kind === 'line' ? [['h', 0, 0]] : [],
      crosses: kind === 'cross' ? [['h', 0, 0]] : [],
    }), caption, null);
    const arrow = () => {
      const s = document.createElement('span');
      s.className = 'help-arrow mi';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = 'arrow_forward';
      return s;
    };
    return [step('none', '空白'), arrow(), step('line', '線'), arrow(), step('cross', '×'), arrow(), step('none', '空白')];
  },
};

/** container の中の [data-fig] に図を入れる（1 回だけ）。 */
export function renderHelpFigures(container) {
  for (const slot of container.querySelectorAll('[data-fig]')) {
    if (slot.childElementCount) continue;
    const make = FIGURES[slot.dataset.fig];
    if (make) slot.append(...make());
  }
}
