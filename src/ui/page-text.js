/**
 * 取り込んだページの、盤の外に書いてある文字（問題番号や題、作者など）を読む。問題のメタデータとして残すため。
 * PDF に文字が埋め込まれていればそれを使い、無ければ（スキャンした PDF や画像）OCR で読む。
 * OCR は tesseract.js（src/vendor/tesseract、Apache-2.0）を、初めて読むときに読み込む。
 */

const BASE = new URL('../vendor/tesseract/', import.meta.url);
/** 残す文字の長さの上限（サーバーも同じ長さで切る）。 */
const MAX_LENGTH = 1000;
/** OCR に渡す画像の長い辺。小さい字も読めるように、取り込みの画像より大きめにする。 */
const OCR_SIDE = 2400;
/** これより自信の低い行は、読み違い（罫線やしみ）とみなして捨てる。 */
const MIN_CONFIDENCE = 50;

let loading = null;
let worker = null;

function loadTesseract() {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('tesseract.min.js', BASE).href;
    s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('文字を読む仕組みを読み込めませんでした')));
    s.onerror = () => { loading = null; reject(new Error('文字を読む仕組みを読み込めませんでした')); };
    document.head.appendChild(s);
  });
  return loading;
}

async function ocrWorker() {
  if (worker) return worker;
  const Tesseract = await loadTesseract();
  worker = await Tesseract.createWorker(['jpn', 'eng'], 1, {
    workerPath: new URL('worker.min.js', BASE).href,
    corePath: new URL('tesseract-core-simd-lstm.wasm.js', BASE).href,
    langPath: BASE.href.replace(/\/$/, ''),
  });
  return worker;
}

/**
 * 盤のまわりの文字を読む。
 * @param {Blob} blob ページの画像
 * @param {{corners:number[][], rows:number, cols:number, width:number, height:number}} board
 *   盤の四隅（画像の座標）とマス数、その座標の元になった画像の大きさ
 * @param {object[]} [pdfText] PDF に埋め込まれた文字（pdf-pages.js の text）
 * @returns {Promise<string>} 読めた文字（無ければ空）
 */
export async function readPageText(blob, board, pdfText) {
  const box = boardBox(board);
  if (pdfText?.length) {
    const outside = pdfText.filter((t) => !inside(box, (t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2));
    const text = tidy(linesOf(outside).join('\n'));
    if (text) return text;
  }
  return ocr(blob, box);
}

/** 盤を囲む箱（画像の幅・高さを 1 とした割合）。盤の線や外の点にかからないよう、半マスぶん広げる。 */
function boardBox({ corners, rows, cols, width, height }) {
  const xs = corners.map(([x]) => x / width);
  const ys = corners.map(([, y]) => y / height);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const mx = ((x1 - x0) / cols) * 0.5;
  const my = ((y1 - y0) / rows) * 0.5;
  return { x0: x0 - mx, x1: x1 + mx, y0: y0 - my, y1: y1 + my };
}

const inside = (b, x, y) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

/** PDF の文字を、上から下・左から右の行にまとめる。 */
function linesOf(items) {
  const sorted = [...items].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines = [];
  for (const t of sorted) {
    const mid = (t.y0 + t.y1) / 2;
    const line = lines.find((l) => Math.abs(l.mid - mid) < Math.max(l.h, t.y1 - t.y0) * 0.6);
    if (line) line.items.push(t);
    else lines.push({ mid, h: t.y1 - t.y0, items: [t] });
  }
  return lines.map((l) => l.items.sort((a, b) => a.x0 - b.x0).map((t) => t.str).join(' '));
}

/** スキャンした画像は、盤を白く塗りつぶしてから OCR にかける（盤の数字を拾わないように）。 */
async function ocr(blob, box) {
  const bitmap = await createImageBitmap(blob);
  const k = Math.min(1, OCR_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  ctx.fillRect(box.x0 * canvas.width, box.y0 * canvas.height, (box.x1 - box.x0) * canvas.width, (box.y1 - box.y0) * canvas.height);

  const w = await ocrWorker();
  const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  const text = lines.length
    ? lines.filter((l) => l.confidence >= MIN_CONFIDENCE).map((l) => l.text).join('\n')
    : data.text;
  return tidy(text);
}

const CJK = '\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef';

/** 日本語の字のあいだの空白（OCR や PDF が入れがち）を詰め、文字の無い行を捨てる。 */
export function tidy(text) {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line) => line
      .replace(/[ \t　]+/g, ' ')
      .replace(new RegExp(`([${CJK}]) (?=[${CJK}])`, 'g'), '$1')
      .trim())
    // 罫線や点のかけらは、記号だけの行になる
    .filter((line) => /[\p{L}\p{N}]/u.test(line))
    .join('\n')
    .slice(0, MAX_LENGTH);
}
