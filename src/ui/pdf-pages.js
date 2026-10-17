/**
 * PDF の各ページを画像（PNG の Blob）にする。管理画面で、問題集の PDF をまとめて取り込むため。
 * pdf.js（src/vendor/pdfjs、Apache-2.0）は、PDF を読むときに初めて読み込む。
 */

const BASE = new URL('../vendor/pdfjs/', import.meta.url);
let loading = null;

function loadPdfjs() {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('pdf.min.js', BASE).href;
    s.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) { reject(new Error('PDF を読む仕組みを読み込めませんでした')); return; }
      lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', BASE).href;
      resolve(lib);
    };
    s.onerror = () => { loading = null; reject(new Error('PDF を読む仕組みを読み込めませんでした')); };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * @param {ArrayBuffer} buf
 * @param {(page:number, total:number)=>void} [onProgress]
 * @returns {AsyncGenerator<{page:number, total:number, blob:Blob, text:object[]}>} 1 ページずつ（大きな PDF でも、まとめて抱えない）。
 *   text は PDF に埋め込まれた文字（スキャンした PDF なら空）。位置はページの幅・高さを 1 とした割合で、
 *   { str, x0, y0, x1, y1 }（左上が 0）。
 */
export async function* pdfPages(buf, onProgress) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress?.(n, doc.numPages);
      const page = await doc.getPage(n);
      // 数字を読むので、長い辺が 2000px くらいになるように描く
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, 2000 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // 背景が透明な PDF でも白地にする
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const text = textBoxes(await page.getTextContent(), viewport);
      page.cleanup();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      yield { page: n, total: doc.numPages, blob, text };
    }
  } finally {
    doc.destroy();
  }
}

/** pdf.js の文字の並びを、ページの割合で表した箱にする。 */
function textBoxes(content, viewport) {
  const boxes = [];
  for (const item of content.items) {
    if (!item.str || !item.str.trim()) continue;
    const [, , , , x, y] = item.transform;
    const h = item.height || Math.hypot(item.transform[2], item.transform[3]);
    const [ax, ay] = viewport.convertToViewportPoint(x, y);
    const [bx, by] = viewport.convertToViewportPoint(x + item.width, y + h);
    boxes.push({
      str: item.str,
      x0: Math.min(ax, bx) / viewport.width, x1: Math.max(ax, bx) / viewport.width,
      y0: Math.min(ay, by) / viewport.height, y1: Math.max(ay, by) / viewport.height,
    });
  }
  return boxes;
}
