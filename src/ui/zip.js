/**
 * ZIP の中のファイルを取り出す（画像をまとめた zip を、管理画面で取り込むため）。
 * 「しまうだけ（0）」と「deflate（8）」に対応する。展開はブラウザの DecompressionStream に任せる。
 */

const utf8 = new TextDecoder();
const sjisDecoder = (() => { try { return new TextDecoder('shift_jis'); } catch { return null; } })();

/**
 * @param {ArrayBuffer} buf
 * @returns {Promise<Array<{name:string, data:Uint8Array}>>} ディレクトリを除いた中身（zip の中の並び順）
 */
export async function unzip(buf) {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  // 末尾の「中央ディレクトリの終わり」を探す（後ろにコメントが付くことがある）
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip ファイルとして読めませんでした');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('zip の目次が壊れています');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const rawName = bytes.subarray(p + 46, p + 46 + nameLen);
    // 名前は UTF-8 の印（flag 11）があれば UTF-8、なければ日本の zip に多い Shift_JIS とみなす
    const name = (flags & 0x800) || !sjisDecoder ? utf8.decode(rawName) : sjisDecoder.decode(rawName);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`パスワード付きの zip は読めません（${name}）`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflate(raw);
    else throw new Error(`この圧縮の形式には対応していません（${name}）`);
    files.push({ name, data });
  }
  return files;
}

async function inflate(raw) {
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
