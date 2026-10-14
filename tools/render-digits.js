/**
 * 印刷の数字（0〜3）を、いろいろな書体で 28×28 の濃淡画像に描いて書き出す（開発用）。
 * tools/train-digits.js に渡すと、手書きと一緒に学習して、写真の印刷の数字も見分けられるようになる。
 *   node tools/render-digits.js [出力 JSON]
 * Playwright（Chromium）が要る。PLAYWRIGHT_PATH で playwright の場所を指定できる。
 */
import { writeFileSync } from 'node:fs';

const out = process.argv[2] || 'printed-digits.json';
const pw = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const { chromium } = pw.chromium ? pw : pw.default;

const FAMILIES = [
  'sans-serif', 'serif', 'monospace', 'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'Liberation Sans',
  'Liberation Serif', 'Liberation Mono', 'FreeSans', 'FreeSerif', 'FreeMono', 'Inter', 'Carlito', 'Caladea',
  'Bitstream Charter', 'Courier 10 Pitch', 'IPAGothic', 'WenQuanYi Zen Hei Mono',
];
const WEIGHTS = [300, 400, 600, 700, 900];

const browser = await chromium.launch();
const page = await browser.newPage();
const samples = await page.evaluate(({ FAMILIES, WEIGHTS }) => {
  const size = 112;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const small = document.createElement('canvas');
  small.width = 28;
  small.height = 28;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  const list = [];
  for (const family of FAMILIES) {
    for (const weight of WEIGHTS) {
      for (const style of ['normal', 'italic']) {
        for (let d = 0; d <= 3; d++) {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, size, size);
          ctx.fillStyle = '#fff';
          ctx.font = `${style} ${weight} 80px "${family}"`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(d), size / 2, size / 2);
          // 黒い部分を囲む四角を、MNIST と同じく 20×20 に収めて 28×28 の真ん中へ
          const { data } = ctx.getImageData(0, 0, size, size);
          let x0 = size, y0 = size, x1 = -1, y1 = -1;
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (data[(y * size + x) * 4] < 100) continue;
              x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
            }
          }
          if (x1 < 0) continue;
          const bw = x1 - x0 + 1;
          const bh = y1 - y0 + 1;
          const k = 20 / Math.max(bw, bh);
          sctx.fillStyle = '#000';
          sctx.fillRect(0, 0, 28, 28);
          sctx.imageSmoothingQuality = 'high';
          sctx.drawImage(canvas, x0, y0, bw, bh, 14 - (bw * k) / 2, 14 - (bh * k) / 2, bw * k, bh * k);
          const px = sctx.getImageData(0, 0, 28, 28).data;
          const pixels = [];
          for (let i = 0; i < 784; i++) pixels.push(px[i * 4]);
          list.push({ digit: d, font: `${family} ${weight} ${style}`, pixels });
        }
      }
    }
  }
  return list;
}, { FAMILIES, WEIGHTS });
await browser.close();
writeFileSync(out, JSON.stringify(samples));
console.log(`${samples.length} 個を ${out} に書き出しました`);
