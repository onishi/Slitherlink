import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanMask, classifyShape } from '../src/ui/digit-features.js';
import { DIGIT_MODEL } from '../src/ui/digit-model.js';

const SIZE = 40;
const blank = () => new Uint8Array(SIZE * SIZE);
const dot = (m, x, y, r = 1.6) => {
  for (let yy = 0; yy < SIZE; yy++) for (let xx = 0; xx < SIZE; xx++) if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) m[yy * SIZE + xx] = 1;
};
/** 点の列をつないで線を描く（手書きの線の代わり）。 */
const stroke = (m, points) => {
  for (let k = 0; k + 1 < points.length; k++) {
    const [x0, y0] = points[k];
    const [x1, y1] = points[k + 1];
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let t = 0; t <= n; t++) dot(m, x0 + ((x1 - x0) * t) / n, y0 + ((y1 - y0) * t) / n);
  }
};
const arc = (cx, cy, rx, ry, a0, a1, n = 24) => Array.from({ length: n + 1 }, (_, k) => {
  const a = a0 + ((a1 - a0) * k) / n;
  return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
});
const best = (p) => p.indexOf(Math.max(...p));

test('手書きふうの 0〜3 を見分ける', () => {
  const zero = blank();
  stroke(zero, arc(20, 20, 8, 13, 0, Math.PI * 2));
  const one = blank();
  stroke(one, [[18, 8], [21, 6], [21, 33]]);
  const two = blank();
  stroke(two, [...arc(20, 14, 8, 7, Math.PI * 1.1, Math.PI * 2.2), [11, 33], [29, 33]]);
  const three = blank();
  stroke(three, arc(19, 13, 8, 6.5, -Math.PI * 0.9, Math.PI * 0.5));
  stroke(three, arc(19, 26, 9, 7, -Math.PI * 0.5, Math.PI * 0.9));
  [zero, one, two, three].forEach((m, d) => {
    const p = classifyShape(DIGIT_MODEL, m, SIZE);
    assert.equal(best(p), d, `${d} を ${best(p)} と読んだ（${p.map((x) => x.toFixed(2))}）`);
  });
});

test('小さなごみや縁にかかる点は消える', () => {
  const m = blank();
  stroke(m, [[20, 6], [20, 33]]);
  dot(m, 2, 2, 1.2); // 角の点のはみ出し
  dot(m, 33, 20, 0.8); // ごみ
  const kept = cleanMask(m, SIZE);
  assert.equal(m[2 * SIZE + 2], 0);
  assert.equal(m[20 * SIZE + 33], 0);
  assert.ok(kept > 50);
});
