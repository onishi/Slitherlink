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
 * @returns {AsyncGenerator<{page:number, total:number, blob:Blob}>} 1 ページずつ（大きな PDF でも、まとめて抱えない）
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
      page.cleanup();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      yield { page: n, total: doc.numPages, blob };
    }
  } finally {
    doc.destroy();
  }
}
