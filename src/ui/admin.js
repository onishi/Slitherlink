/**
 * 管理画面：問題集を作り、画像・zip・PDF から問題をまとめて取り込む。
 *
 * 取り込みは 1 枚（PDF なら 1 ページ）に 1 問。写真から作るときと同じ仕組みで、盤の四隅とマス数を見つけて
 * 数字を読み、論理だけで解けるかを裏のワーカーで確かめる。うまくいかなかったものは「直す」で、
 * 写真から作るときと同じ画面を開いて手で直せる。解けたものだけを問題集に足す。
 */

import { account, api } from './account.js';
import { loadPhoto, guessCorners, readClues, rectify } from './image-reader.js';
import { PhotoImport } from './photo-import.js';
import { DIFFICULTIES } from '../core/generator.js';
import { problemStats } from '../core/difficulty-report.js';
import { decodePuzzle } from '../core/puzzle.js';
import { unzip } from './zip.js';
import { pdfPages } from './pdf-pages.js';

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const icon = (name) => {
  const s = el('span', 'mi', name);
  s.setAttribute('aria-hidden', 'true');
  return s;
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|heic)$/i;

let books = [];
let booksLoading = null;
let current = null;   // 開いている問題集 { book, problems }
let queue = [];       // 取り込み中のもの
let queueSeq = 0;
let editing = null;   // 「直す」で開いている取り込み

/* ---------------- 起動とログイン ---------------- */

async function start() {
  account.onChange = () => gate();
  await account.init();
  gate();
}

function gate() {
  const ok = account.loggedIn && account.isAdmin;
  $('admin-main').hidden = !ok;
  $('admin-gate').hidden = ok;
  renderAccount();
  if (ok) {
    // ログインの確かめで何度か呼ばれても、読み込みは 1 回だけ
    if (!books.length) booksLoading ??= loadBooks().finally(() => { booksLoading = null; });
    return;
  }
  const text = $('gate-text');
  const login = $('gate-login');
  login.textContent = '';
  if (!account.ready) { text.textContent = '確かめています…'; return; }
  if (!account.loggedIn) {
    text.textContent = '管理画面を使うには、管理者の Google アカウントでログインしてください。';
    account.renderButton(login);
  } else {
    text.textContent = 'このアカウントは管理者ではありません。';
  }
}

function renderAccount() {
  const box = $('admin-account');
  box.textContent = '';
  if (!account.loggedIn) return;
  box.append(el('span', null, account.user.name || account.user.email || ''));
  const out = el('button', 'account-logout', 'ログアウト');
  out.type = 'button';
  out.addEventListener('click', () => account.logout());
  box.append(out);
}

/* ---------------- 問題集 ---------------- */

async function loadBooks(selectId) {
  books = (await api('/api/admin/books')).books;
  renderBooks();
  const id = selectId ?? current?.book.id ?? books[0]?.id;
  if (id != null) await openBook(id);
  else $('book').hidden = true;
}

function renderBooks() {
  const list = $('book-list');
  list.textContent = '';
  if (!books.length) {
    list.append(el('li', 'admin-empty', 'まだありません。上で名前を入れて作ってください。'));
    return;
  }
  for (const b of books) {
    const li = el('li');
    const btn = el('button', `admin-book-item${current?.book.id === b.id ? ' is-on' : ''}`);
    btn.type = 'button';
    btn.append(el('b', null, b.title), el('small', null, `${b.count} 問${b.published ? '・公開中' : ''}`));
    btn.addEventListener('click', () => openBook(b.id));
    li.append(btn);
    list.append(li);
  }
}

async function openBook(id) {
  current = await api(`/api/admin/books/${id}`);
  $('book').hidden = false;
  $('book-title').value = current.book.title;
  $('book-desc').value = current.book.description;
  $('book-published').checked = current.book.published;
  renderBooks();
  renderProblems();
  fillMissingStats();
}

function renderProblems() {
  const list = $('problems');
  list.textContent = '';
  $('problem-count').textContent = `${current.problems.length} 問`;
  if (!current.problems.length) {
    list.append(el('li', 'admin-empty', 'まだありません。上から画像・zip・PDF を落として足してください。'));
    return;
  }
  current.problems.forEach((p, i) => {
    const li = el('li', 'admin-problem');
    const text = el('span', 'admin-problem-text');
    text.append(
      el('b', null, `${p.position}. ${p.rows}×${p.cols} ${DIFFICULTIES[p.difficulty]?.label ?? ''}`),
      el('small', null, `数字 ${p.clueCount}${p.source ? `・${p.source}` : ''}`),
      statsLine(p.stats),
    );
    const play = el('a', 'admin-link');
    play.href = `./?p=${encodeURIComponent(p.code)}`;
    play.target = '_blank';
    play.rel = 'noopener';
    play.append(icon('play_arrow'), '遊ぶ');
    const up = iconButton('arrow_upward', '1 つ上へ', () => moveProblem(p, 'up'));
    up.disabled = i === 0;
    const down = iconButton('arrow_downward', '1 つ下へ', () => moveProblem(p, 'down'));
    down.disabled = i === current.problems.length - 1;
    const del = iconButton('delete', 'この問題を外す', () => removeProblem(p));
    li.append(text, play, up, down, del);
    list.append(li);
  });
}

/** 難易度のほかの目安を 1 行で。まだ計算していなければ、そう出す。 */
function statsLine(st) {
  const line = el('span', 'admin-stats');
  if (!st) { line.textContent = '目安を計算しています…'; return line; }
  const chip = (label, value, title) => {
    const c = el('span', 'admin-stat', `${label} ${value}`);
    c.title = title;
    return c;
  };
  line.append(
    chip('線', `${st.loopLength ?? '?'} 本`, '答えの輪の長さ（引く線の本数）'),
    chip('定石', `${st.patternShare}%`, '定石（ふつう・読み）だけで決まる辺の割合'),
    chip('仮定なし', `${st.freeShare}%`, '最初に仮定が要るまでに決まる割合（要らなければ 100%）'),
    chip('仮定', st.assumeCount ? `${st.assumeCount} 回・最長 ${st.longestSteps} 手` : 'なし', '仮定が要る回数と、いちばん長い読みの手数'),
  );
  return line;
}

/** 目安を持たずに登録した問題（前からある問題）を、開いたときに計算して埋める。 */
let filling = false;
async function fillMissingStats() {
  if (filling || !current) return;
  filling = true;
  try {
    const bookId = current.book.id;
    for (const p of current.problems.filter((x) => !x.stats)) {
      let r;
      try {
        const d = decodePuzzle(p.code);
        r = await checker(d.rows, d.cols, d.clues);
      } catch { continue; }
      if (!r.ok || r.status !== 'ok' || !r.report) continue;
      const stats = problemStats(r.report, r.solution);
      await api(`/api/admin/books/${bookId}/problems/${p.id}`, { method: 'PATCH', body: { stats, difficulty: r.difficulty } });
      if (current?.book.id !== bookId) return;
      // 計算しているあいだに読み直していても、いま出している方を直す
      const shown = current.problems.find((x) => x.id === p.id);
      if (shown) { shown.stats = stats; shown.difficulty = r.difficulty; }
      renderProblems();
    }
  } finally {
    filling = false;
  }
}

function iconButton(name, label, run) {
  const b = el('button', 'icon-btn');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.append(icon(name));
  b.addEventListener('click', run);
  return b;
}

async function moveProblem(p, move) {
  await api(`/api/admin/books/${current.book.id}/problems/${p.id}`, { method: 'PATCH', body: { move } });
  await openBook(current.book.id);
}

async function removeProblem(p) {
  if (!confirm(`${p.position} 問目（${p.rows}×${p.cols}）をこの問題集から外しますか？`)) return;
  await api(`/api/admin/books/${current.book.id}/problems/${p.id}`, { method: 'DELETE' });
  await loadBooks(current.book.id);
}

function bindBooks() {
  $('new-book').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const title = $('new-book-title').value.trim();
    if (!title) return;
    const { book } = await api('/api/admin/books', { method: 'POST', body: { title } });
    $('new-book-title').value = '';
    await loadBooks(book.id);
  });
  $('book-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await api(`/api/admin/books/${current.book.id}`, {
      method: 'PATCH',
      body: { title: $('book-title').value, description: $('book-desc').value, published: $('book-published').checked },
    });
    await loadBooks(current.book.id);
  });
  $('book-delete').addEventListener('click', async () => {
    const { book } = current;
    if (!confirm(`「${book.title}」と、その中の ${current.problems.length} 問を消します。元に戻せません。よろしいですか？`)) return;
    await api(`/api/admin/books/${book.id}`, { method: 'DELETE' });
    current = null;
    await loadBooks();
  });
}

/* ---------------- まとめて取り込む ---------------- */

// 論理だけで解けるかは、写真から作るときと同じワーカーで確かめる
const checker = (() => {
  let worker = null;
  let seq = 0;
  const waiting = new Map();
  return (rows, cols, clues) => new Promise((resolve) => {
    worker ??= new Worker(new URL('../worker/check-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => { waiting.get(ev.data.id)?.(ev.data); waiting.delete(ev.data.id); };
    const id = ++seq;
    waiting.set(id, resolve);
    worker.postMessage({ id, rows, cols, clues: Array.from(clues) });
  });
})();

/** 落とされたファイルを、1 問ずつの画像に分けて並べる。 */
async function addFiles(fileList) {
  const files = [...fileList];
  $('queue-head').hidden = false;
  for (const file of files) {
    const name = file.name || '画像';
    try {
      if (/\.pdf$/i.test(name) || file.type === 'application/pdf') {
        setStatus(`${name} を開いています…`);
        for await (const { page, total, blob } of pdfPages(await file.arrayBuffer(), (n, t) => setStatus(`${name} を画像にしています（${n} / ${t} ページ）…`))) {
          enqueue(blob, total > 1 ? `${name} p.${page}` : name);
        }
      } else if (/\.zip$/i.test(name) || /zip/.test(file.type)) {
        setStatus(`${name} を開いています…`);
        const entries = (await unzip(await file.arrayBuffer()))
          .filter((f) => IMAGE_EXT.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name))
          // 「1.png, 2.png, 10.png」が数の順に並ぶように
          .sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
        if (!entries.length) addError(name, 'zip の中に画像がありませんでした');
        for (const f of entries) enqueue(new Blob([f.data], { type: mimeOf(f.name) }), `${name} / ${f.name.split('/').pop()}`);
      } else if (file.type.startsWith('image/') || IMAGE_EXT.test(name)) {
        enqueue(file, name);
      } else {
        addError(name, '画像・zip・PDF ではないので飛ばしました');
      }
    } catch (err) {
      addError(name, err.message || '読み込めませんでした');
    }
  }
  pump();
}

function mimeOf(name) {
  const ext = name.split('.').pop().toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' }[ext] ?? 'application/octet-stream';
}

function enqueue(blob, name) {
  queue.push({ id: ++queueSeq, name, blob, state: 'waiting', message: '待っています', result: null, thumb: null });
  renderQueue();
}

function addError(name, message) {
  queue.push({ id: ++queueSeq, name, blob: null, state: 'error', message, result: null, thumb: null });
  renderQueue();
}

// 1 枚ずつ順に読む（たくさん落としても、画面とメモリを詰まらせない）
let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const item = queue.find((q) => q.state === 'waiting');
      if (!item) break;
      item.state = 'reading';
      item.message = '読んでいます…';
      renderQueue();
      await readItem(item);
      renderQueue();
    }
  } finally {
    pumping = false;
    setStatus('');
    renderQueue();
  }
}

async function readItem(item) {
  try {
    const photo = await loadPhoto(item.blob);
    const guess = guessCorners(photo);
    item.thumb = thumbOf(photo);
    if (!guess.rows || !guess.cols) {
      item.state = 'warn';
      item.message = '盤のマス数を見つけられませんでした。「直す」で四隅とマス数を合わせてください';
      return;
    }
    const { clues } = readClues(photo, guess.corners, guess.rows, guess.cols);
    item.thumb = rectify(photo, guess.corners, guess.rows, guess.cols, 12).toDataURL('image/jpeg', 0.8);
    const r = await checker(guess.rows, guess.cols, clues);
    applyCheck(item, guess.rows, guess.cols, r);
  } catch (err) {
    item.state = 'error';
    item.message = err.message || '読み込めませんでした';
  }
}

function thumbOf(photo) {
  const c = document.createElement('canvas');
  const k = 96 / Math.max(photo.width, photo.height);
  c.width = Math.round(photo.width * k);
  c.height = Math.round(photo.height * k);
  c.getContext('2d').drawImage(photo.canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

function applyCheck(item, rows, cols, r) {
  if (!r.ok) {
    item.state = 'error';
    item.message = `確かめられませんでした（${r.error}）`;
  } else if (r.status === 'ok') {
    item.state = 'ok';
    item.result = {
      code: r.code, rows, cols, difficulty: r.difficulty, clueCount: r.clueCount,
      stats: r.report ? problemStats(r.report, r.solution) : null,
    };
    item.message = `${rows}×${cols}・${DIFFICULTIES[r.difficulty]?.label ?? ''}・数字 ${r.clueCount}`;
  } else {
    item.state = 'warn';
    item.message = r.status === 'contradiction'
      ? `${rows}×${cols}：数字が矛盾しています。読み間違いを「直す」で直してください`
      : `${rows}×${cols}：論理だけでは解き切れません。読み間違い・抜けを「直す」で確かめてください`;
  }
}

function renderQueue() {
  const list = $('queue');
  list.textContent = '';
  for (const item of queue) {
    const li = el('li', `admin-queue-item is-${item.state}`);
    const thumb = el('span', 'admin-thumb');
    if (item.thumb) {
      const img = el('img');
      img.src = item.thumb;
      img.alt = '';
      thumb.append(img);
    } else {
      thumb.append(icon(item.state === 'error' ? 'error' : item.generated ? 'auto_awesome' : 'hourglass_empty'));
    }
    const text = el('span', 'admin-queue-text');
    text.append(el('b', null, item.name), el('small', null, item.message));
    li.append(thumb, text);
    if (item.state === 'ok') li.append(el('span', 'admin-ok', '解けます'));
    if (item.blob && (item.state === 'ok' || item.state === 'warn')) {
      const fix = el('button', null);
      fix.type = 'button';
      fix.append(icon('edit'), '直す');
      fix.addEventListener('click', () => editItem(item));
      li.append(fix);
    }
    li.append(iconButton('close', '取り込みから外す', () => {
      queue = queue.filter((q) => q !== item);
      renderQueue();
    }));
    list.append(li);
  }
  const ok = queue.filter((q) => q.state === 'ok').length;
  const busy = queue.some((q) => q.state === 'waiting' || q.state === 'reading' || q.state === 'generating');
  $('queue-add').disabled = !ok || busy || !current;
  $('queue-add-label').textContent = `解けたものを足す（${ok} 問）`;
  $('queue-head').hidden = !queue.length;
  if (!busy && queue.length) {
    const warn = queue.filter((q) => q.state === 'warn').length;
    const err = queue.filter((q) => q.state === 'error').length;
    setStatus(`${queue.length} 件：解ける ${ok}・直しが要る ${warn}${err ? `・読めない ${err}` : ''}`);
  } else if (busy) {
    const done = queue.filter((q) => q.state !== 'waiting' && q.state !== 'reading' && q.state !== 'generating').length;
    const making = queue.some((q) => q.state === 'generating');
    setStatus(`${making ? '作っています' : '読んでいます'}（${done} / ${queue.length}）…`);
  }
}

function setStatus(text) { $('queue-status').textContent = text; }

/* 「直す」：写真から作るときと同じ画面で、四隅・マス数・数字を手で直す */
const editor = new PhotoImport({
  modal: $('photo-modal'),
  canvas: $('photo-canvas'),
  rowsInput: $('photo-rows'),
  colsInput: $('photo-cols'),
  readBtn: $('photo-read'),
  alignStep: $('photo-step-align'),
  editStep: $('photo-step-edit'),
  grid: $('photo-grid'),
  status: $('photo-status'),
  report: $('photo-report'),
  backBtn: $('photo-back'),
  saveBtn: $('photo-save'),
  playBtn: $('photo-play'),
  closeBtn: $('photo-close'),
}, {
  onPlay: (p) => window.open(`./?p=${encodeURIComponent(p.code)}`, '_blank', 'noopener'),
  onSave: (p) => {
    if (!editing) return false;
    editing.state = 'ok';
    editing.result = {
      code: p.code, rows: p.rows, cols: p.cols, difficulty: p.difficulty, clueCount: p.clueCount,
      stats: p.report ? problemStats(p.report, p.solution) : null,
    };
    editing.message = `${p.rows}×${p.cols}・${DIFFICULTIES[p.difficulty]?.label ?? ''}・数字 ${p.clueCount}（直したもの）`;
    renderQueue();
    editor.close();
    editing = null;
    return true;
  },
  saveText: { idle: 'この内容で使う', done: '使います', message: '取り込みの一覧に戻しました。' },
});

async function editItem(item) {
  editing = item;
  try {
    await editor.open(item.blob);
  } catch (err) {
    alert(err.message || '画像を開けませんでした');
  }
}

async function addSolved() {
  const ready = queue.filter((q) => q.state === 'ok');
  if (!ready.length || !current) return;
  $('queue-add').disabled = true;
  try {
    const res = await api(`/api/admin/books/${current.book.id}/problems`, {
      method: 'POST',
      body: { problems: ready.map((q) => ({ ...q.result, source: q.name })) },
    });
    queue = queue.filter((q) => q.state !== 'ok');
    renderQueue();
    setStatus(`${res.added} 問を足しました${res.skipped ? `（${res.skipped} 問はもう入っていたので飛ばしました）` : ''}`);
    await loadBooks(current.book.id);
  } catch (err) {
    setStatus(err.message);
    renderQueue();
  }
}

/* ---------------- ランダムに作る ---------------- */

const LEVEL_ORDER = ['intro', 'easy', 'normal', 'hard', 'expert'];
let genWorker = null;
let genStop = false;
let genPending = null; // いま待っている 1 問（止めたときに、待ちを終わらせる）

/** 作る問題ごとの難易度。「いろいろ」なら 5 段階を同じくらいずつ、やさしい順に並べる。 */
function plannedLevels(choice, count) {
  if (choice !== 'mix') return new Array(count).fill(choice);
  return Array.from({ length: count }, (_, i) => LEVEL_ORDER[Math.floor((i * LEVEL_ORDER.length) / count)]);
}

function generateOne(rows, cols, difficulty) {
  genWorker ??= new Worker(new URL('../worker/generate-worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve) => {
    const id = Math.random();
    const done = (r) => { genPending = null; resolve(r); };
    genPending = done;
    genWorker.onmessage = (ev) => { if (ev.data.id === id) done(ev.data); };
    genWorker.onerror = () => done({ ok: false, error: '作問中にエラーが起きました' });
    genWorker.postMessage({ id, rows, cols, difficulty, withStats: true, timeLimitMs: 20000 });
  });
}

async function generateBatch(rows, cols, count, choice) {
  const levels = plannedLevels(choice, count);
  const items = levels.map((level, i) => ({
    id: ++queueSeq, generated: true, name: `ランダム ${rows}×${cols}（${i + 1} / ${count}）`,
    blob: null, state: 'generating', message: `「${DIFFICULTIES[level].label}」を作るのを待っています`, result: null, thumb: null, level,
  }));
  queue.push(...items);
  genStop = false;
  $('gen-start').disabled = true;
  $('gen-stop').hidden = false;
  renderQueue();
  try {
    for (const item of items) {
      if (genStop) break;
      item.message = `「${DIFFICULTIES[item.level].label}」を作っています…`;
      renderQueue();
      const r = await generateOne(rows, cols, item.level);
      if (genStop && !r.ok) break;
      if (!r.ok) {
        item.state = 'error';
        item.message = r.error || '作れませんでした';
        continue;
      }
      const p = r.puzzle;
      item.state = 'ok';
      item.result = { code: p.code, rows: p.rows, cols: p.cols, difficulty: p.difficulty, clueCount: p.clueCount, stats: p.stats ?? null };
      const missed = p.difficulty !== item.level ? `（「${DIFFICULTIES[item.level].label}」は時間内に作れず）` : '';
      item.message = `${p.rows}×${p.cols}・${DIFFICULTIES[p.difficulty]?.label ?? ''}・数字 ${p.clueCount}${missed}`;
      renderQueue();
    }
  } finally {
    // 止めたときは、まだ作っていない分を一覧から外す
    queue = queue.filter((q) => q.state !== 'generating');
    $('gen-start').disabled = false;
    $('gen-stop').hidden = true;
    renderQueue();
    if (genStop && !queue.length) setStatus('');
  }
}

function bindGenerate() {
  $('gen-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const n = (id, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number($(id).value) || lo)));
    generateBatch(n('gen-rows', 3, 50), n('gen-cols', 3, 50), n('gen-count', 1, 100), $('gen-difficulty').value);
  });
  $('gen-stop').addEventListener('click', () => {
    genStop = true;
    // いま作っている 1 問も打ち切る
    genWorker?.terminate();
    genWorker = null;
    genPending?.({ ok: false, error: '止めました' });
  });
}

function bindImport() {
  const drop = $('drop');
  $('files').addEventListener('change', (ev) => {
    const files = ev.target.files;
    if (files?.length) addFiles(files);
    ev.target.value = '';
  });
  drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    drop.classList.remove('is-over');
    if (ev.dataTransfer?.files?.length) addFiles(ev.dataTransfer.files);
  });
  $('queue-add').addEventListener('click', addSolved);
  $('queue-clear').addEventListener('click', () => {
    queue = queue.filter((q) => q.state === 'waiting' || q.state === 'reading');
    renderQueue();
  });
}

bindBooks();
bindImport();
bindGenerate();
start();
