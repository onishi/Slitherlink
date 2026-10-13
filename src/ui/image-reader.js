/**
 * 問題の写真から数字を読み取る。外部のライブラリは使わず、ブラウザの canvas だけで行う。
 *
 * 1. 画像を灰色の濃淡に直す（長い辺を 1400px まで縮める）
 * 2. 盤の四隅（いちばん外側の点）を、利用者が合わせた 4 点で受け取る
 * 3. 四隅から射影変換を求め、傾きや遠近のゆがみを戻して各マスの中だけを切り出す
 * 4. マスの中の黒い部分が少なければ空白、あれば 0〜3 の文字の型と見比べて一番近い数字にする
 *
 * 読み取りは完全ではないので、結果は利用者が直せる形で返す（どのマスが怪しいかも付ける）。
 */

const MAX_SIDE = 1400;
const PATCH = 40;    // 1 マスを切り出す大きさ（px）
const NORM = 20;     // 文字を見比べるときの大きさ
const DIGITS = [0, 1, 2, 3];
const FONTS = [
  '600 64px sans-serif', '400 64px sans-serif', '700 64px sans-serif',
  '400 64px serif', '700 64px serif', '400 64px monospace', '700 64px monospace',
];

/** File（写真）を読み込み、灰色の濃淡の配列にする。 */
export async function loadPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('画像を読み込めませんでした'));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    return { canvas, width: w, height: h, gray };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 濃淡の配列から、黒と白を分けるしきい値（大津の方法）。 */
export function otsu(values) {
  const hist = new Float64Array(256);
  for (const v of values) hist[Math.max(0, Math.min(255, v | 0))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

/**
 * 盤の四隅とマス数の見当をつける。
 * 黒い小さなかたまりのうち、いちばん多い大きさのもの（＝盤の点）を集め、
 * いちばん外側の 4 つを四隅にする。点の間隔からマス数も見積もる。
 * 傾いた写真でも、四隅は「左上＝x+y が最小」のように選ぶので合う。
 * 点が見つからなければ、黒い部分を囲む四角にする。あとで利用者が合わせ直す。
 * @returns {{corners:number[][], rows:number|null, cols:number|null}}
 */
export function guessCorners(photo) {
  const { width: w, height: h, gray } = photo;
  // 600px 程度に縮め（縮めるときは平均をとる）、さらに 3×3 でならしてざらつきを消す
  const step = Math.max(1, Math.round(Math.max(w, h) / 600));
  const W = Math.floor(w / step);
  const Hh = Math.floor(h / step);
  const raw = new Float32Array(W * Hh);
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) sum += gray[(y * step + dy) * w + x * step + dx];
      raw[y * W + x] = sum / (step * step);
    }
  }
  const small = new Float32Array(W * Hh);
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= Hh || xx >= W) continue;
          sum += raw[yy * W + xx];
          cnt++;
        }
      }
      small[y * W + x] = sum / cnt;
    }
  }
  // まわりの平均より目立って暗いところを黒とみなす（明るさのむらや、ぼけた薄い点に強くするため）
  const integral = new Float64Array((W + 1) * (Hh + 1));
  for (let y = 0; y < Hh; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += small[y * W + x];
      integral[(y + 1) * (W + 1) + x + 1] = integral[y * (W + 1) + x + 1] + row;
    }
  }
  const R = Math.max(4, Math.round(Math.max(W, Hh) / 40));
  const dark = new Uint8Array(W * Hh);
  for (let y = 0; y < Hh; y++) {
    const ya = Math.max(0, y - R);
    const yb = Math.min(Hh, y + R + 1);
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - R);
      const xb = Math.min(W, x + R + 1);
      const sum = integral[yb * (W + 1) + xb] - integral[ya * (W + 1) + xb] - integral[yb * (W + 1) + xa] + integral[ya * (W + 1) + xa];
      const mean = sum / ((yb - ya) * (xb - xa));
      dark[y * W + x] = small[y * W + x] < mean - Math.max(14, mean * 0.1) ? 1 : 0;
    }
  }

  // 黒いかたまりを数える（4 近傍）
  const label = new Int32Array(W * Hh).fill(-1);
  const blobs = [];
  const stack = [];
  for (let i = 0; i < dark.length; i++) {
    if (!dark[i] || label[i] >= 0) continue;
    const blob = { area: 0, x0: W, y0: Hh, x1: 0, y1: 0, sx: 0, sy: 0 };
    label[i] = blobs.length;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop();
      const x = j % W;
      const y = (j - x) / W;
      blob.area++;
      blob.sx += x;
      blob.sy += y;
      if (x < blob.x0) blob.x0 = x;
      if (x > blob.x1) blob.x1 = x;
      if (y < blob.y0) blob.y0 = y;
      if (y > blob.y1) blob.y1 = y;
      for (const k of [j - 1, j + 1, j - W, j + W]) {
        if (k < 0 || k >= dark.length || label[k] >= 0 || !dark[k]) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === W - 1)) continue;
        label[k] = blobs.length;
        stack.push(k);
      }
    }
    blobs.push(blob);
  }

  // 点らしいもの：小さく、縦横が近く、中が詰まっている
  const maxDim = Math.max(W, Hh) * 0.04;
  const dots = blobs.filter((b) => {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    return b.area >= 3 && bw <= maxDim && bh <= maxDim && bw / bh < 2 && bh / bw < 2 && b.area >= bw * bh * 0.45;
  });
  if (dots.length >= 9) {
    const sizes = dots.map((b) => Math.max(b.x1 - b.x0, b.y1 - b.y0) + 1).sort((a, b) => a - b);
    // いちばん多い大きさのあたりに集まるものだけ（数字の「1」の切れ端などを外す）
    const inBand = (s1, s0) => s1 >= Math.min(s0 * 0.75, s0 - 1) && s1 <= Math.max(s0 * 1.35, s0 + 1);
    let bestSize = sizes[0];
    let bestCount = 0;
    for (const s0 of sizes) {
      const n = sizes.filter((s1) => inBand(s1, s0)).length;
      if (n > bestCount) { bestCount = n; bestSize = s0; }
    }
    const pts = dots
      .filter((b) => inBand(Math.max(b.x1 - b.x0, b.y1 - b.y0) + 1, bestSize))
      .map((b) => [(b.sx / b.area + 0.5) * step, (b.sy / b.area + 0.5) * step]);
    if (pts.length >= 9) {
      const fit = fitLattice(pts);
      if (fit) return fit;
    }
  }

  // 点が見つからないときは、黒い部分の端（1% と 99%）を囲む四角
  const xs = [];
  const ys = [];
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (dark[y * W + x]) { xs.push(x * step); ys.push(y * step); }
  if (xs.length < 10) {
    return { corners: [[w * 0.1, h * 0.1], [w * 0.9, h * 0.1], [w * 0.9, h * 0.9], [w * 0.1, h * 0.9]], rows: null, cols: null };
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const at = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
  const x0 = at(xs, 0.01);
  const x1 = at(xs, 0.99);
  const y0 = at(ys, 0.01);
  const y1 = at(ys, 0.99);
  return { corners: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], rows: null, cols: null };
}

/**
 * 点の集まりに格子の番号（列 i・行 j）をふり、全部の点から射影変換を当てはめて四隅を出す。
 * 一部の点が隠れていても（ボタンや指がかぶっていても）、残りの点から四隅が決まる。
 */
function fitLattice(pts) {
  const n = pts.length;
  // となりの点へのずれ（近いもの 4 つまで）を集め、向きの多い 2 方向を格子の向きにする
  const vecs = [];
  pts.forEach((p, a) => {
    const near = [];
    pts.forEach((q, b) => {
      if (a !== b) near.push([Math.hypot(p[0] - q[0], p[1] - q[1]), q[0] - p[0], q[1] - p[1]]);
    });
    near.sort((x, y) => x[0] - y[0]);
    for (const [d, dx, dy] of near.slice(0, 4)) if (d < near[0][0] * 1.6) vecs.push([dx, dy]);
  });
  const BINS = 36;
  const angleOf = ([dx, dy]) => ((Math.atan2(dy, dx) % Math.PI) + Math.PI) % Math.PI;
  const binOf = (v) => Math.floor((angleOf(v) / Math.PI) * BINS) % BINS;
  const hist = new Array(BINS).fill(0);
  for (const v of vecs) hist[binOf(v)]++;
  const smooth = hist.map((_, k) => hist[(k + BINS - 1) % BINS] + 2 * hist[k] + hist[(k + 1) % BINS]);
  const binDist = (x, y) => Math.min(Math.abs(x - y), BINS - Math.abs(x - y));
  const peak1 = smooth.indexOf(Math.max(...smooth));
  let peak2 = -1;
  smooth.forEach((v, k) => { if (binDist(k, peak1) >= 10 && (peak2 < 0 || v > smooth[peak2])) peak2 = k; });
  if (peak2 < 0 || !smooth[peak2]) return null;
  const axisOf = (peak) => {
    const t = ((peak + 0.5) / BINS) * Math.PI;
    const dir = [Math.cos(t), Math.sin(t)];
    const list = vecs.filter((v) => binDist(binOf(v), peak) <= 2)
      .map(([dx, dy]) => (dx * dir[0] + dy * dir[1] >= 0 ? [dx, dy] : [-dx, -dy]));
    const median = (k) => list.map((v) => v[k]).sort((x, y) => x - y)[Math.floor(list.length / 2)];
    return [median(0), median(1)];
  };
  let ax = axisOf(peak1);
  let ay = axisOf(peak2);
  if (Math.abs(ax[0]) < Math.abs(ay[0])) [ax, ay] = [ay, ax];
  if (ax[0] < 0) ax = [-ax[0], -ax[1]];
  if (ay[1] < 0) ay = [-ay[0], -ay[1]];
  const unit = Math.min(Math.hypot(...ax), Math.hypot(...ay));

  // 近い点を探すための升目
  const cell = unit * 0.5;
  const bucket = new Map();
  const keyOf = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  pts.forEach((p, k) => {
    const key = keyOf(p[0], p[1]);
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push(k);
  });
  const findNear = (x, y, tol) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let best = -1;
    let d = tol;
    for (let yy = cy - 1; yy <= cy + 1; yy++) {
      for (let xx = cx - 1; xx <= cx + 1; xx++) {
        for (const k of bucket.get(`${xx},${yy}`) ?? []) {
          const e = Math.hypot(pts[k][0] - x, pts[k][1] - y);
          if (e < d) { d = e; best = k; }
        }
      }
    }
    return best;
  };

  // となりへたどって番号をふる（ずれは、たどった先で少しずつ直す。遠近のゆがみに合わせるため）
  const ij = new Array(n).fill(null);
  let bestGroup = [];
  for (let s = 0; s < n; s++) {
    if (ij[s]) continue;
    const group = [s];
    ij[s] = { i: 0, j: 0, ax, ay };
    for (let q = 0; q < group.length; q++) {
      const k = group[q];
      const { i, j, ax: lx, ay: ly } = ij[k];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const vx = di * lx[0] + dj * ly[0];
        const vy = di * lx[1] + dj * ly[1];
        const m = findNear(pts[k][0] + vx, pts[k][1] + vy, unit * 0.3);
        if (m < 0 || ij[m]) continue;
        const real = [pts[m][0] - pts[k][0], pts[m][1] - pts[k][1]];
        const nx = di ? [real[0] * di, real[1] * di] : lx;
        const ny = dj ? [real[0] * dj, real[1] * dj] : ly;
        ij[m] = { i: i + di, j: j + dj, ax: nx, ay: ny };
        group.push(m);
      }
    }
    if (group.length > bestGroup.length) bestGroup = group;
  }
  if (bestGroup.length < 9) return null;
  // 端の列・行で点がまばらなもの（紙の縁や、ごみがたまたま並んだもの）は外す
  const trim = (key) => {
    const count = new Map();
    for (const k of bestGroup) count.set(ij[k][key], (count.get(ij[k][key]) ?? 0) + 1);
    const keys = [...count.keys()].sort((a, b) => a - b);
    const top = Math.max(...count.values());
    let lo = 0;
    let hi = keys.length - 1;
    while (lo < hi && count.get(keys[lo]) < top * 0.4) lo++;
    while (hi > lo && count.get(keys[hi]) < top * 0.4) hi--;
    return [keys[lo], keys[hi]];
  };
  const [i0, i1] = trim('i');
  const [j0, j1] = trim('j');
  bestGroup = bestGroup.filter((k) => ij[k].i >= i0 && ij[k].i <= i1 && ij[k].j >= j0 && ij[k].j <= j1);
  const cols = i1 - i0;
  const rows = j1 - j0;
  if (cols < 2 || rows < 2 || cols > 30 || rows > 30) return null;
  const H = fitHomography(bestGroup.map((k) => [ij[k].i - i0, ij[k].j - j0, pts[k][0], pts[k][1]]));
  if (!H) return null;
  const corners = [[0, 0], [cols, 0], [cols, rows], [0, rows]].map(([u, v]) => project(H, u, v));
  return { corners, rows, cols };
}

/** 対応する点の組 [u, v, x, y] から、最小二乗で射影変換を求める。 */
function fitHomography(pairs) {
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const add = (row, b) => {
    for (let a = 0; a < 8; a++) {
      Atb[a] += row[a] * b;
      for (let c = 0; c < 8; c++) AtA[a][c] += row[a] * row[c];
    }
  };
  for (const [u, v, x, y] of pairs) {
    add([u, v, 1, 0, 0, 0, -u * x, -v * x], x);
    add([0, 0, 0, u, v, 1, -u * y, -v * y], y);
  }
  const h = solve(AtA, Atb);
  if (h.some((x) => !Number.isFinite(x))) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * 射影変換を求める。盤の座標 (u, v)（u は列、v は行。四隅は (0,0) (C,0) (C,R) (0,R)）から、
 * 画像の座標へ移す 3×3 の行列を返す。
 */
export function homography(corners, rows, cols) {
  const src = [[0, 0], [cols, 0], [cols, rows], [0, rows]];
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i];
    const [x, y] = corners[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  const h = solve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** 盤の座標を画像の座標へ。 */
export function project(H, u, v) {
  const z = H[6] * u + H[7] * v + H[8];
  return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z];
}

/** ガウスの消去法で Ax = b を解く（8×8）。 */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const p = M[col][col] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / p;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** 画像の濃淡を、なめらかに（となりの 4 点を混ぜて）読む。 */
function sampleGray(photo, x, y) {
  const { width: w, height: h, gray } = photo;
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const i = y0 * w + x0;
  return gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy)
    + gray[i + w] * (1 - fx) * fy + gray[i + w + 1] * fx * fy;
}

/** 1 マスの中（点や線にかからない内側）を PATCH×PATCH で切り出す。 */
function cellPatch(photo, H, r, c) {
  const out = new Float32Array(PATCH * PATCH);
  const m = 0.16; // マスの縁から内側へ入る割合
  for (let j = 0; j < PATCH; j++) {
    for (let i = 0; i < PATCH; i++) {
      const u = c + m + ((i + 0.5) / PATCH) * (1 - 2 * m);
      const v = r + m + ((j + 0.5) / PATCH) * (1 - 2 * m);
      const [x, y] = project(H, u, v);
      out[j * PATCH + i] = sampleGray(photo, x, y);
    }
  }
  return out;
}

/**
 * 黒い部分を囲む四角だけを切り抜き、縦横比を保って NORM×NORM に縮める。
 * 縮めるときは面積で平均するので、細かなざらつきやぼけの差が出にくい。
 * @param {Uint8Array} mask 黒（文字）かどうか。囲む四角を決めるのに使う
 * @param {Float32Array} ink 墨の濃さ（0〜1）
 * @returns {{v:Float32Array, ink:number, bw:number, bh:number}|null} 黒が無ければ null
 */
function normalize(mask, ink, size) {
  let x0 = size;
  let y0 = size;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask[y * size + x]) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const box = Math.max(bw, bh);
  const ox = x0 - (box - bw) / 2;
  const oy = y0 - (box - bh) / 2;
  const v = new Float32Array(NORM * NORM);
  const cell = box / NORM;
  const sub = Math.max(1, Math.ceil(cell * 2));
  for (let j = 0; j < NORM; j++) {
    for (let i = 0; i < NORM; i++) {
      let sum = 0;
      for (let b = 0; b < sub; b++) {
        for (let a = 0; a < sub; a++) {
          const sx = Math.floor(ox + (i + (a + 0.5) / sub) * cell);
          const sy = Math.floor(oy + (j + (b + 0.5) / sub) * cell);
          if (sx >= 0 && sy >= 0 && sx < size && sy < size) sum += ink[sy * size + sx];
        }
      }
      v[j * NORM + i] = sum / (sub * sub);
    }
  }
  return { v, ink: count, bw, bh };
}

let templates = null;

/** 0〜3 を、いくつかの書体で描いて型にする（最初の 1 回だけ）。 */
function digitTemplates() {
  if (templates) return templates;
  templates = [];
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (const font of FONTS) {
    for (const d of DIGITS) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000';
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(d), size / 2, size / 2);
      const { data } = ctx.getImageData(0, 0, size, size);
      const mask = new Uint8Array(size * size);
      const ink = new Float32Array(size * size);
      for (let i = 0; i < size * size; i++) {
        mask[i] = data[i * 4] < 128 ? 1 : 0;
        ink[i] = 1 - data[i * 4] / 255;
      }
      const n = normalize(mask, ink, size);
      if (n) templates.push({ digit: d, v: n.v });
    }
  }
  return templates;
}

/** 2 つの濃さの並びの似かた（相関係数、-1〜1）。 */
function correlation(a, b) {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n;
  mb /= n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

/**
 * 盤の数字を読み取る。
 * @param {object} photo loadPhoto の結果
 * @param {number[][]} corners 盤の四隅（左上・右上・右下・左下）の画像上の座標
 * @returns {{clues:Int8Array, unsure:boolean[]}} 数字（-1 は空白）と、自信の無いマス
 */
export function readClues(photo, corners, rows, cols) {
  const H = homography(corners, rows, cols);
  const tpl = digitTemplates();
  // 盤の中全体から、黒と白を分けるしきい値を決める
  const values = [];
  for (let j = 0; j <= 60; j++) {
    for (let i = 0; i <= 60; i++) {
      const [x, y] = project(H, (i / 60) * cols, (j / 60) * rows);
      values.push(sampleGray(photo, x, y));
    }
  }
  const threshold = otsu(values);
  // 黒と白の濃さの差。マスごとに、そのマスの白さから測って半分より暗いところを文字とみなす
  // （影や、上にかぶった薄いボタンなどを文字と取り違えないため）
  const darkVals = values.filter((v) => v < threshold);
  const lightVals = values.filter((v) => v >= threshold);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const contrast = Math.max(40, mean(lightVals) - mean(darkVals));
  const clues = new Int8Array(rows * cols).fill(-1);
  const unsure = new Array(rows * cols).fill(false);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const patch = cellPatch(photo, H, r, c);
      const mask = new Uint8Array(PATCH * PATCH);
      const sorted = Array.from(patch).sort((a, b) => a - b);
      const paper = sorted[Math.floor(sorted.length * 0.9)];
      const cut = Math.min(threshold, paper - contrast * 0.5);
      const ink = new Float32Array(PATCH * PATCH);
      for (let i = 0; i < patch.length; i++) {
        mask[i] = patch[i] < cut ? 1 : 0;
        ink[i] = Math.max(0, Math.min(1, (paper - patch[i]) / contrast));
      }
      const n = normalize(mask, ink, PATCH);
      // 黒がほとんど無い、または小さすぎるなら空白（点やごみ）
      if (!n || n.ink < PATCH * PATCH * 0.03 || n.bh < PATCH * 0.3) continue;
      const scores = DIGITS.map((d) => Math.max(...tpl.filter((t) => t.digit === d).map((t) => correlation(n.v, t.v))));
      const order = DIGITS.slice().sort((a, b) => scores[b] - scores[a]);
      clues[r * cols + c] = order[0];
      unsure[r * cols + c] = scores[order[0]] < 0.6 || scores[order[0]] - scores[order[1]] < 0.05;
    }
  }
  return { clues, unsure };
}
