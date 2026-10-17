import test from 'node:test';
import assert from 'node:assert/strict';
import { homography, project, guessCorners, otsu } from '../src/ui/image-reader.js';

test('射影変換は四隅を合わせた位置へ移す', () => {
  const corners = [[10, 20], [310, 40], [300, 260], [5, 240]];
  const H = homography(corners, 5, 7);
  const close = (a, b) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, `${a} ≠ ${b}`);
  close(project(H, 0, 0), corners[0]);
  close(project(H, 7, 0), corners[1]);
  close(project(H, 7, 5), corners[2]);
  close(project(H, 0, 5), corners[3]);
});

test('大津のしきい値は 2 つの山の間に来る', () => {
  const values = [...new Array(100).fill(30), ...new Array(300).fill(220)];
  const t = otsu(values);
  assert.ok(t >= 30 && t < 220);
});

test('傾いた盤の点から、四隅とマス数を見つける（一部の点が隠れていても）', () => {
  const w = 600;
  const h = 600;
  const gray = new Float32Array(w * h).fill(235);
  const rows = 6;
  const cols = 8;
  const truth = [[80, 110], [520, 70], [540, 470], [70, 500]];
  const H = homography(truth, rows, cols);
  for (let v = 0; v <= rows; v++) {
    for (let u = 0; u <= cols; u++) {
      if (u === cols && v === 0) continue; // 右上の点はボタンなどで隠れている
      const [x, y] = project(H, u, v);
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy <= 9) gray[Math.round(y + dy) * w + Math.round(x + dx)] = 40;
        }
      }
    }
  }
  // 数字らしい大きめの黒も少し置く
  for (const [u, v] of [[1.5, 1.5], [4.5, 2.5], [6.5, 4.5]]) {
    const [x, y] = project(H, u, v);
    for (let dy = -12; dy <= 12; dy++) for (let dx = -6; dx <= 6; dx++) if (Math.abs(dx) > 3 || Math.abs(dy) > 9) gray[Math.round(y + dy) * w + Math.round(x + dx)] = 40;
  }
  const guess = guessCorners({ width: w, height: h, gray });
  assert.equal(guess.rows, rows);
  assert.equal(guess.cols, cols);
  guess.corners.forEach((p, i) => assert.ok(Math.hypot(p[0] - truth[i][0], p[1] - truth[i][1]) < 4, `角 ${i}: ${p} ≠ ${truth[i]}`));
});

test('教師データの大きな盤（20×36）も、四隅とマス数を見つける（題名の「●」などに惑わされない）', () => {
  // 見開き 1 ページを 1400px に縮めたくらいの大きさ。点は小さめ
  const w = 955;
  const h = 1400;
  const gray = new Float32Array(w * h).fill(250);
  const rows = 36;
  const cols = 20;
  const x0 = 170;
  const y0 = 185;
  const s = 30.6;
  const blot = (cx, cy, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) gray[Math.round(cy + dy) * w + Math.round(cx + dx)] = 20;
    }
  };
  for (let v = 0; v <= rows; v++) for (let u = 0; u <= cols; u++) blot(x0 + u * s, y0 + v * s, 2);
  blot(x0 + 110, y0 - 45, 3); // 「作●活火山」の●
  blot(x0 + 5, y0 + rows * s + 50, 2); // ページ番号のあたりの汚れ
  const guess = guessCorners({ width: w, height: h, gray });
  assert.equal(guess.rows, rows);
  assert.equal(guess.cols, cols);
  const truth = [[x0, y0], [x0 + cols * s, y0], [x0 + cols * s, y0 + rows * s], [x0, y0 + rows * s]];
  guess.corners.forEach((p, i) => assert.ok(Math.hypot(p[0] - truth[i][0], p[1] - truth[i][1]) < 4, `角 ${i}: ${p} ≠ ${truth[i]}`));
});
