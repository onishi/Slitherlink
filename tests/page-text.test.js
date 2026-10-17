import test from 'node:test';
import assert from 'node:assert/strict';
import { tidy } from '../src/ui/page-text.js';

test('読んだ文字は、日本語の字のあいだの空白を詰め、記号だけの行を捨てる', () => {
  assert.equal(tidy('ス リ ザ ー リ ン ク  第 12 問\n  ・ ・ ― \n作者 : 山田 太郎\n'), 'スリザーリンク第 12 問\n作者 : 山田太郎');
  assert.equal(tidy(''), '');
  assert.equal(tidy(null), '');
  assert.equal(tidy('あ'.repeat(2000)).length, 1000);
});
