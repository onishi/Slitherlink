/**
 * 公開用のファイルだけを _site/ に集める。
 * 新しいページを足したら PAGES にも追加すること。
 * テストや開発用ツールは配信しない。
 *   node tools/build-site.js [出力先]
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(root, '_site');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const PAGES = ['index.html', 'patterns.html'];
for (const page of PAGES) await cp(join(root, page), join(out, page));
await cp(join(root, 'src'), join(out, 'src'), { recursive: true });
// GitHub Pages で Jekyll の処理を通さないための目印
await writeFile(join(out, '.nojekyll'), '');

console.log(`公開用ファイルを ${out} に用意しました`);
