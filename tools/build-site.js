/**
 * 公開用のファイルだけを _site/ に集める。
 * テストや開発用ツールは配信しない。
 *   node tools/build-site.js [出力先]
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(root, '_site');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'index.html'), join(out, 'index.html'));
await cp(join(root, 'src'), join(out, 'src'), { recursive: true });
// GitHub Pages で Jekyll の処理を通さないための目印
await writeFile(join(out, '.nojekyll'), '');

console.log(`公開用ファイルを ${out} に用意しました`);
