/**
 * マスから切り出した文字を、見比べやすい形にそろえる（写真の読み取りと、手書き数字の学習で共通）。
 * DOM を使わないので、node の学習スクリプトからも読み込める。
 */

export const NORM = 20; // 文字を見比べるときの大きさ

/**
 * 黒い部分を囲む四角だけを切り抜き、縦横比を保って NORM×NORM に縮める。
 * 縮めるときは面積で平均するので、細かなざらつきやぼけの差が出にくい。
 * @param {Uint8Array} mask 黒（文字）かどうか。囲む四角を決めるのに使う
 * @param {Float32Array} ink 墨の濃さ（0〜1）
 * @returns {{v:Float32Array, ink:number, bw:number, bh:number}|null} 黒が無ければ null
 */
export function normalize(mask, ink, size) {
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

/**
 * 黒い部分のうち、小さなかたまり（ごみ・点・紙のざらつき）を消す。
 * いちばん大きいかたまりの 15% に満たないものと、マスの縁に触れている小さなもの（線や点のはみ出し）を外す。
 * @returns {number} 残った黒の画素数
 */
export function cleanMask(mask, size) {
  const label = new Int32Array(size * size).fill(-1);
  const comps = [];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    const comp = { pixels: [], border: false };
    label[s] = comps.length;
    stack.push(s);
    while (stack.length) {
      const j = stack.pop();
      comp.pixels.push(j);
      const x = j % size;
      const y = (j - x) / size;
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) comp.border = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          const k = yy * size + xx;
          if (!mask[k] || label[k] >= 0) continue;
          label[k] = comps.length;
          stack.push(k);
        }
      }
    }
    comps.push(comp);
  }
  if (!comps.length) return 0;
  const biggest = Math.max(...comps.map((c) => c.pixels.length));
  let kept = 0;
  for (const comp of comps) {
    const n = comp.pixels.length;
    const drop = n < biggest * 0.15 || (comp.border && n < biggest * 0.5);
    if (drop) for (const j of comp.pixels) mask[j] = 0;
    else kept += n;
  }
  return kept;
}

/** 黒い部分を 1 画素ぶん太らせる（grow）か、やせさせた新しい並び。 */
export function thicken(mask, size, grow) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let any = false;
      let all = true;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx;
        const yy = y + dy;
        const v = xx >= 0 && yy >= 0 && xx < size && yy < size ? mask[yy * size + xx] : 0;
        if (v) any = true; else all = false;
      }
      out[y * size + x] = (grow ? any : all) ? 1 : 0;
    }
  }
  return out;
}

/**
 * 線の太さを変えた 3 通り（そのまま・細く・太く）でネットに見せ、確率を平均する。
 * ペンの細さや、にじみで太った線に左右されにくくするため。
 */
export function classifyShape(model, mask, size) {
  const sum = [0, 0, 0, 0];
  let n = 0;
  for (const m of [mask, thicken(mask, size, false), thicken(mask, size, true)]) {
    const shape = normalize(m, Float32Array.from(m), size);
    if (!shape || shape.ink < 4) continue;
    classify(model, shape.v).forEach((p, d) => { sum[d] += p; });
    n++;
  }
  return sum.map((v) => v / Math.max(1, n));
}

/**
 * 手書き数字の小さなニューラルネット（400 → 隠れ層 → 4）で 0〜3 の確からしさを出す。
 * @param {object} model digit-model.js の中身
 * @param {Float32Array} v normalize の結果（NORM×NORM）
 * @returns {number[]} 0〜3 それぞれの確率
 */
export function classify(model, v) {
  if (!model.w1f) unpack(model);
  const { inputs, hidden, outputs, w1f, b1, w2f, b2 } = model;
  const h = new Float32Array(hidden);
  for (let k = 0; k < hidden; k++) {
    let sum = b1[k];
    const row = k * inputs;
    for (let i = 0; i < inputs; i++) sum += w1f[row + i] * v[i];
    h[k] = sum > 0 ? sum : 0;
  }
  const z = new Array(outputs);
  for (let o = 0; o < outputs; o++) {
    let sum = b2[o];
    for (let k = 0; k < hidden; k++) sum += w2f[o * hidden + k] * h[k];
    z[o] = sum;
  }
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m));
  const total = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / total);
}

/** 8 ビットに詰めた重みを、計算に使う数に戻す（最初の 1 回だけ）。 */
function unpack(model) {
  const bytes = (b64) => {
    const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const out = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;
    return out;
  };
  model.w1f = Float32Array.from(bytes(model.w1), (x) => x * model.s1);
  model.w2f = Float32Array.from(bytes(model.w2), (x) => x * model.s2);
}
