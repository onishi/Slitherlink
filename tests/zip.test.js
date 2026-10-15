import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzip } from '../src/ui/zip.js';

// Python の zipfile で、しまうだけ・deflate・フォルダ・日本語の名前が混じった zip を作って読む
test('zip の中身を取り出す', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const out = join(dir, 'a.zip');
  execFileSync('python3', ['-c', `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr(zipfile.ZipInfo('pages/'), '')
    z.writestr('pages/問題1.png', b'\\x89PNG' + bytes(range(256)) * 40, compress_type=zipfile.ZIP_DEFLATED)
    z.writestr('pages/2.jpg', b'JPEGDATA', compress_type=zipfile.ZIP_STORED)
`, out]);
  const buf = readFileSync(out);
  const files = await unzip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.deepEqual(files.map((f) => f.name), ['pages/問題1.png', 'pages/2.jpg']);
  assert.equal(files[0].data.length, 4 + 256 * 40);
  assert.equal(files[0].data[300], (300 - 4) % 256);
  assert.equal(new TextDecoder().decode(files[1].data), 'JPEGDATA');
});

test('zip でないものは断る', async () => {
  await assert.rejects(unzip(new Uint8Array(100).buffer), /zip ファイルとして読めませんでした/);
});
