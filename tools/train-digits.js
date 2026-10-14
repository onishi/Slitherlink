/**
 * 手書き数字（0〜3）を見分ける小さなニューラルネットを学習し、src/ui/digit-model.js に書き出す（開発用）。
 *   node tools/train-digits.js <MNIST のフォルダ> [世代数] [印刷の数字の JSON]
 *
 * MNIST（train-images-idx3-ubyte.gz など 4 つ）の 0〜3 だけを使う。
 * tools/render-digits.js で描いた印刷の数字も渡すと、一緒に学習する（写真の印刷の数字向け）。
 * 写真の読み取りと同じ前処理（digit-features.js の cleanMask と normalize）を通してから学習する。
 * 写真のペンの細さ・太さ、傾きのばらつきに強くするため、世代ごとに形を少しずつ変えて
 * （回転・斜め・縦横比・線の太さ・しきい値）学習する。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { NORM, normalize, cleanMask, classify, thicken } from '../src/ui/digit-features.js';

const dir = process.argv[2];
const epochs = Number(process.argv[3] || 12);
const printedFile = process.argv[4];
if (!dir) {
  console.error('使い方: node tools/train-digits.js <MNIST のフォルダ> [世代数]');
  process.exit(1);
}

function load(images, labels) {
  const img = gunzipSync(readFileSync(join(dir, images)));
  const lab = gunzipSync(readFileSync(join(dir, labels)));
  const n = lab.readUInt32BE(4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = lab[8 + i];
    if (d > 3) continue;
    out.push({ digit: d, pixels: img.subarray(16 + i * 784, 16 + (i + 1) * 784) });
  }
  return out;
}

/* ---------------- 形を少し変える ---------------- */

let seed = 12345;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const between = (a, b) => a + (b - a) * rand();

const BIG = 56; // 28 を 2 倍にした大きさで形を変える

function warp(pixels, opts) {
  const { angle, shear, sx, sy, threshold } = opts;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const mask = new Uint8Array(BIG * BIG);
  for (let y = 0; y < BIG; y++) {
    for (let x = 0; x < BIG; x++) {
      // 出力の点 → 元の 28×28 の点（中心のまわりで逆変換）
      let u = (x + 0.5 - BIG / 2) / 2;
      let v = (y + 0.5 - BIG / 2) / 2;
      u -= shear * v;
      const ru = (cos * u + sin * v) / sx;
      const rv = (-sin * u + cos * v) / sy;
      const px = ru + 14 - 0.5;
      const py = rv + 14 - 0.5;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      if (x0 < 0 || y0 < 0 || x0 >= 27 || y0 >= 27) continue;
      const fx = px - x0;
      const fy = py - y0;
      const at = (xx, yy) => pixels[yy * 28 + xx] / 255;
      const val = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy)
        + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
      mask[y * BIG + x] = val > threshold ? 1 : 0;
    }
  }
  return mask;
}

function features(sample, augment) {
  const opts = augment
    ? { angle: between(-0.26, 0.26), shear: between(-0.3, 0.3), sx: between(0.75, 1.2), sy: between(0.85, 1.15), threshold: between(0.25, 0.6) }
    : { angle: 0, shear: 0, sx: 1, sy: 1, threshold: 0.4 };
  let mask = warp(sample.pixels, opts);
  if (augment) {
    // 線の太さ：細く・そのまま・太く（3 段階まで）
    const t = rand();
    if (t < 0.22) mask = thicken(mask, BIG, false);
    else if (t < 0.4) mask = thicken(mask, BIG, true);
    else if (t < 0.55) mask = thicken(thicken(mask, BIG, true), BIG, true);
    else if (t < 0.65) mask = thicken(thicken(thicken(mask, BIG, true), BIG, true), BIG, true);
  }
  cleanMask(mask, BIG);
  const ink = Float32Array.from(mask);
  const n = normalize(mask, ink, BIG);
  return n ? n.v : null;
}

/* ---------------- 学習 ---------------- */

const train = load('train-images-idx3-ubyte.gz', 'train-labels-idx1-ubyte.gz');
const printed = printedFile ? JSON.parse(readFileSync(printedFile, 'utf8')) : [];
// 印刷の数字は種類が少ないので、何度か入れて（毎回形を変えるので同じにはならない）手書きとの釣り合いをとる
for (let rep = 0; rep < 4; rep++) for (const p of printed) train.push({ digit: p.digit, pixels: Uint8Array.from(p.pixels) });
const test = load('t10k-images-idx3-ubyte.gz', 't10k-labels-idx1-ubyte.gz');
const IN = NORM * NORM;
const HID = 64;
const OUT = 4;
const w1 = Float32Array.from({ length: HID * IN }, () => between(-1, 1) * Math.sqrt(6 / (IN + HID)));
const b1 = new Float32Array(HID);
const w2 = Float32Array.from({ length: OUT * HID }, () => between(-1, 1) * Math.sqrt(6 / (HID + OUT)));
const b2 = new Float32Array(OUT);
console.log(`学習 ${train.length} 個・確認 ${test.length} 個`);

const h = new Float32Array(HID);
const dh = new Float32Array(HID);
for (let epoch = 0; epoch < epochs; epoch++) {
  const lr = 0.02 * (1 - epoch / epochs) + 0.002;
  const order = train.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let loss = 0;
  for (const idx of order) {
    const sample = train[idx];
    const x = features(sample, true);
    if (!x) continue;
    for (let k = 0; k < HID; k++) {
      let s = b1[k];
      const row = k * IN;
      for (let i = 0; i < IN; i++) s += w1[row + i] * x[i];
      h[k] = s > 0 ? s : 0;
    }
    const z = new Float32Array(OUT);
    for (let o = 0; o < OUT; o++) {
      let s = b2[o];
      for (let k = 0; k < HID; k++) s += w2[o * HID + k] * h[k];
      z[o] = s;
    }
    const m = Math.max(...z);
    const e = z.map((v) => Math.exp(v - m));
    const total = e.reduce((a, b) => a + b, 0);
    const p = e.map((v) => v / total);
    loss -= Math.log(p[sample.digit] + 1e-9);
    dh.fill(0);
    for (let o = 0; o < OUT; o++) {
      const g = p[o] - (o === sample.digit ? 1 : 0);
      for (let k = 0; k < HID; k++) {
        dh[k] += g * w2[o * HID + k];
        w2[o * HID + k] -= lr * g * h[k];
      }
      b2[o] -= lr * g;
    }
    for (let k = 0; k < HID; k++) {
      if (h[k] <= 0) continue;
      const g = dh[k];
      const row = k * IN;
      for (let i = 0; i < IN; i++) w1[row + i] -= lr * g * x[i];
      b1[k] -= lr * g;
    }
  }
  console.log(`世代 ${epoch + 1}: 損失 ${(loss / order.length).toFixed(4)}`);
}

/* ---------------- 8 ビットに詰めて書き出す ---------------- */

const pack = (w) => {
  const s = Math.max(...w.map(Math.abs)) / 127;
  const q = Int8Array.from(w, (v) => Math.round(v / s));
  return { s, b64: Buffer.from(q.buffer).toString('base64') };
};
const p1 = pack(w1);
const p2 = pack(w2);
const model = {
  inputs: IN, hidden: HID, outputs: OUT,
  s1: p1.s, w1: p1.b64, b1: Array.from(b1, (v) => +v.toFixed(5)),
  s2: p2.s, w2: p2.b64, b2: Array.from(b2, (v) => +v.toFixed(5)),
};

// 確認用データで、詰めたあとの重みのまま確かめる
const check = (augment) => {
  const m = { ...model };
  let ok = 0;
  let n = 0;
  for (const sample of test) {
    const x = features(sample, augment);
    if (!x) continue;
    const p = classify(m, x);
    if (p.indexOf(Math.max(...p)) === sample.digit) ok++;
    n++;
  }
  return ((ok / n) * 100).toFixed(2);
};
console.log(`確認用の正答率: そのまま ${check(false)}%・形を変えて ${check(true)}%`);
if (printed.length) {
  const m = { ...model };
  let ok = 0;
  for (const p of printed) {
    const x = features({ digit: p.digit, pixels: Uint8Array.from(p.pixels) }, true);
    const q = x && classify(m, x);
    if (q && q.indexOf(Math.max(...q)) === p.digit) ok++;
  }
  console.log(`印刷の数字（形を変えて）: ${((ok / printed.length) * 100).toFixed(2)}%`);
}

writeFileSync(new URL('../src/ui/digit-model.js', import.meta.url), `/**
 * 手書き数字（0〜3）を見分けるニューラルネットの重み。tools/train-digits.js が書き出す（手で直さない）。
 * MNIST（Yann LeCun, Corinna Cortes, Christopher J.C. Burges, CC BY-SA 3.0）の 0〜3 と、
 * いろいろな書体で描いた印刷の数字（tools/render-digits.js）で学習。
 */
export const DIGIT_MODEL = ${JSON.stringify(model)};
`);
console.log('src/ui/digit-model.js に書き出しました');
