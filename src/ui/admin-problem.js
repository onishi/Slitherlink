/**
 * 管理画面：問題 1 問の詳細。盤（答えも見られる）、問題集の中での位置と前後の問題、
 * 情報と目安、くわしい解き味（裏のワーカーで解き進めて調べる）を出す。
 * 目安が欠けていれば、調べた結果で埋めて保存する。
 */

import { $, el, api, startAdmin, checker, boardSvg, metricGuide, ORIGIN_LABEL } from './admin-common.js';
import { renderReport } from './puzzle-report.js';
import { DIFFICULTIES } from '../core/generator.js';
import { problemStats } from '../core/difficulty-report.js';
import { decodePuzzle } from '../core/puzzle.js';

const id = Number(new URLSearchParams(location.search).get('id'));
let puzzle = null;
let solution = null;

async function load() {
  if (!Number.isInteger(id) || id <= 0) { $('detail-title').textContent = '問題が指定されていません'; return; }
  let data;
  try {
    data = await api(`/api/admin/problems/${id}`);
  } catch (err) {
    $('detail-title').textContent = err.message || '読み込めませんでした';
    return;
  }
  const p = data.problem;
  document.title = `${p.bookTitle} ${p.position} - Grid Loop 管理`;
  $('detail-title').textContent = `${p.bookTitle}　${p.position} / ${data.bookCount} 問目`;
  link($('prev'), data.prevId);
  link($('next'), data.nextId);
  $('to-book').href = `../admin.html?book=${p.bookId}`;
  $('play').href = `../?p=${encodeURIComponent(p.code)}`;
  puzzle = decodePuzzle(p.code);
  drawBoard();
  renderFacts(p);
  renderMetrics(p);
  $('detail-body').hidden = false;
  $('report-section').hidden = false;
  analyze(p);
}

function link(a, to) {
  a.hidden = to == null;
  if (to != null) a.href = `problem.html?id=${to}`;
}

function drawBoard() {
  const box = $('board');
  box.textContent = '';
  box.append(boardSvg(puzzle, $('show-answer').checked ? solution : null));
}

/** 名前と値の組を <dl> に並べる。note は値の下に小さく出す説明。 */
function facts(dl, items) {
  dl.textContent = '';
  for (const [label, value, note] of items) {
    const dd = el('dd', null, value);
    if (note) dd.append(el('small', null, note));
    dl.append(el('dt', null, label), dd);
  }
}

function renderFacts(p) {
  const cells = p.rows * p.cols;
  const items = [
    ['問題集', p.bookTitle],
    ['大きさ', `${p.rows}×${p.cols}（${cells} マス）`],
    ['むずかしさ', DIFFICULTIES[p.difficulty]?.label ?? '—'],
    ['出どころ', ORIGIN_LABEL[p.origin ?? 'unknown']],
  ];
  if (p.source) items.push([p.origin === 'generated' ? '作ったとき' : '取り込んだもの', p.source]);
  if (p.createdAt) items.push(['登録', new Date(p.createdAt).toLocaleString('ja-JP')]);
  items.push(['問題コード', p.code]);
  facts($('facts'), items);
}

function renderMetrics(p) {
  const cells = p.rows * p.cols;
  const dash = (v, f) => (v == null ? '—' : f(v));
  facts($('metrics'), [
    ['数字', `${p.clueCount} 個（${Math.round((100 * p.clueCount) / cells)}%）`, 'マス数に対する数字の割合'],
    ['線', dash(p.loopLength, (v) => `${v} 本（1 マスあたり ${(v / cells).toFixed(2)}）`), '答えの輪の長さ'],
    ['行き渡り', dash(p.coverage, (v) => `${v}%`), '4 辺のどれか 1 本でも線が通るマスの割合'],
    ['最大の空き地', dash(p.largestGap, (v) => `${v}%（${Math.round((v * cells) / 100)} マス）`), '線の通らないマスがつながった、いちばん大きいかたまり'],
    ['定石', dash(p.patternShare, (v) => `${v}%`), '定石（ふつう・読み）だけで決まる辺の割合'],
    ['仮定なし', dash(p.freeShare, (v) => `${v}%`), '最初に仮定が要るまでに決まる割合'],
    ['仮定', dash(p.assumeCount, (v) => (v ? `${v} 回・最長 ${p.longestSteps} 手` : 'なし')), '仮定が要る回数と、いちばん長い読みの手数'],
  ]);
}

async function analyze(p) {
  const r = await checker(puzzle.rows, puzzle.cols, puzzle.clues);
  const box = $('report');
  if (!r.ok || r.status !== 'ok' || !r.report) {
    box.textContent = '';
    box.append(el('p', 'report-wait', r.ok ? '論理だけでは解き切れませんでした。' : (r.error || '調べられませんでした。')));
    return;
  }
  solution = r.solution;
  $('show-answer').disabled = false;
  renderReport(box, r.report);
  // 目安が欠けていれば（目安を持つ前に登録した問題）、いま調べた結果で埋めて保存する
  if (p.coverage == null || p.patternShare == null || p.largestGap == null) {
    const stats = problemStats(r.report, r.solution, p);
    await api(`/api/admin/books/${p.bookId}/problems/${p.id}`, { method: 'PATCH', body: { stats, difficulty: r.difficulty } });
    renderMetrics({ ...p, ...stats, difficulty: r.difficulty });
  }
}

$('metrics').after(metricGuide());
$('show-answer').addEventListener('change', drawBoard);
// 一覧に戻るときは、最後に見ていた絞り込みと並べ替えのまま
try {
  const last = sessionStorage.getItem('admin-problems-query');
  if (last) $('to-list').href = `problems.html${last}`;
} catch { /* 覚えていなければ、絞り込みなしの一覧へ */ }
startAdmin(() => load());
