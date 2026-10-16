/**
 * メニューの「問題集」。公開中の問題集を並べ、1 冊を開くと問題の一覧（解いた問題には印）を出す。
 * 問題集から遊んでいるあいだは、どの問題集の何番かを覚えておき、解いたら「次の問題」へ進めるようにする。
 * ログインした人だけが使う（サーバーも、ログインしていなければ断る）。
 * 解いた印はサーバーが付ける（解いた履歴を送ると、同じ問題コードの問題に印が付く）。
 */

import { api } from './account.js';
import { DIFFICULTIES } from '../core/generator.js';

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
const formatTime = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export class BookShelf {
  /**
   * @param {object} hooks
   * @param {(name: string) => void} hooks.showView  メニューの中の画面を切り替える
   * @param {(code: string) => boolean} hooks.play   問題コードを読み込んで遊び始める（読み込めたら true）
   * @param {() => void} hooks.closeMenu
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.current = null; // いま遊んでいる問題集 { book, problems, index }
    this.opened = null;  // メニューで開いている問題集 { book, problems }
    $('btn-book-back').addEventListener('click', () => this.showList());
  }

  /** 問題集の一覧を出す（開くたびに読み直す：解いた数が変わるので）。 */
  async showList() {
    this.hooks.showView('books');
    const list = $('book-list');
    list.textContent = '';
    list.append(el('li', 'library-empty', '読み込んでいます…'));
    let books;
    try {
      ({ books } = await api('/api/books'));
    } catch (err) {
      list.textContent = '';
      list.append(el('li', 'library-empty', err.message || '読み込めませんでした'));
      return;
    }
    list.textContent = '';
    if (!books.length) {
      list.append(el('li', 'library-empty', 'まだ遊べる問題集がありません。'));
      return;
    }
    for (const b of books) {
      const li = el('li');
      const btn = el('button', 'book-item');
      btn.type = 'button';
      const text = el('span', 'library-text');
      text.append(el('b', null, b.title));
      if (b.description) text.append(el('small', null, b.description));
      text.append(progressBar(b.solved, b.count));
      btn.append(icon(b.solved === b.count ? 'workspace_premium' : 'menu_book'), text, icon('chevron_right'));
      btn.addEventListener('click', () => this.open(b.id));
      li.append(btn);
      list.append(li);
    }
  }

  /** 問題集 1 冊を開いて、問題の一覧を出す。 */
  async open(id) {
    this.hooks.showView('book');
    $('book-title').textContent = '読み込んでいます…';
    $('book-desc').textContent = '';
    $('book-progress').textContent = '';
    $('book-grid').textContent = '';
    try {
      this.opened = await api(`/api/books/${id}`);
    } catch (err) {
      $('book-title').textContent = err.message || '読み込めませんでした';
      return;
    }
    // いま遊んでいる問題集なら、手元で付けた印も合わせる（サーバーへの記録が届く前でも）
    if (this.current?.book.id === id) {
      for (const p of this.opened.problems) {
        const mine = this.current.problems.find((x) => x.id === p.id);
        if (mine?.solved && !p.solved) Object.assign(p, { solved: true, seconds: mine.seconds, hints: mine.hints, solvedAt: mine.solvedAt });
      }
    }
    this.renderBook();
  }

  renderBook() {
    const { book, problems } = this.opened;
    $('book-title').textContent = book.title;
    $('book-desc').textContent = book.description || '';
    const solved = problems.filter((p) => p.solved).length;
    const progress = $('book-progress');
    progress.textContent = '';
    progress.append(progressBar(solved, problems.length));
    const grid = $('book-grid');
    grid.textContent = '';
    // 1 問 1 行：番号・大きさとむずかしさ・解いた時間（ヒントの回数と日付）
    problems.forEach((p, i) => {
      const li = el('li');
      const btn = el('button', `book-problem${p.solved ? ' is-solved' : ''}${this.isPlaying(p) ? ' is-current' : ''}`);
      btn.type = 'button';
      const level = DIFFICULTIES[p.difficulty]?.label ?? '';
      const what = el('span', 'book-problem-what');
      what.append(el('span', null, `${p.rows}×${p.cols}`), el('small', null, level));
      const result = el('span', 'book-problem-result');
      if (p.solved) {
        const time = el('b', 'book-check');
        time.append(icon('check_circle'), p.seconds != null ? formatTime(p.seconds) : '解いた');
        const notes = [];
        if (p.hints) notes.push(`ヒント ${p.hints}`);
        if (p.solvedAt) { const d = new Date(p.solvedAt); notes.push(`${d.getMonth() + 1}/${d.getDate()}`); }
        result.append(time);
        if (notes.length) result.append(el('small', null, notes.join('・')));
      } else {
        result.append(el('small', 'book-unsolved', this.isPlaying(p) ? '遊んでいる' : 'まだ'));
      }
      btn.append(el('b', 'book-problem-no', String(p.position)), what, result);
      btn.setAttribute('aria-label', `${p.position} 番 ${p.rows}×${p.cols} ${level}${p.solved ? ` 解いた${p.seconds != null ? ` ${formatTime(p.seconds)}` : ''}` : ''}`);
      btn.addEventListener('click', () => this.playAt(this.opened, i));
      li.append(btn);
      grid.append(li);
    });
  }

  isPlaying(p) {
    return this.current?.problems[this.current.index]?.id === p.id;
  }

  /** 問題集の i 番目の問題で遊び始める。 */
  playAt(set, i) {
    this.current = { book: set.book, problems: set.problems, index: i };
    if (this.hooks.play(set.problems[i].code)) this.hooks.closeMenu();
  }

  /**
   * 問題が変わったときに呼ぶ。問題集の問題でなくなったら、問題集で遊んでいる状態を終える
   * （問題集の中の別の問題なら、その番号へ移る）。
   */
  onPuzzleChanged(code) {
    if (!this.current) return;
    const i = this.current.problems.findIndex((p) => p.code === code);
    if (i < 0) this.current = null;
    else this.current.index = i;
  }

  /** いま遊んでいる問題集の問題の説明（「とことん01　3 / 99」）。問題集で遊んでいなければ null。 */
  label() {
    if (!this.current) return null;
    const { book, problems, index } = this.current;
    return `${book.title}　${problems[index].position} / ${problems.length}`;
  }

  /** 解いたとき：印（時間・ヒントの回数）を付けて、次に遊ぶ問題（まだ解いていない、後ろの問題。無ければ前から）を返す。 */
  onSolved({ seconds, hints } = {}) {
    if (!this.current) return null;
    const { problems, index } = this.current;
    const p = problems[index];
    if (!p.solved || (seconds != null && (p.seconds == null || seconds < p.seconds))) {
      if (seconds != null) { p.seconds = seconds; p.hints = hints ?? 0; }
    }
    if (!p.solved) p.solvedAt = Date.now();
    p.solved = true;
    for (let k = 1; k < problems.length; k++) {
      const j = (index + k) % problems.length;
      if (!problems[j].solved) return j;
    }
    return null; // ぜんぶ解いた
  }

  /** 次の問題へ。 */
  playNext(j) {
    if (!this.current || j == null) return;
    this.playAt({ book: this.current.book, problems: this.current.problems }, j);
  }

  /** 遊んでいる問題集をメニューで開く。 */
  openCurrent() {
    if (this.current) this.open(this.current.book.id);
  }
}

/** 「解いた 3 / 10」と帯。 */
function progressBar(solved, total) {
  const box = el('span', 'book-bar-wrap');
  const bar = el('span', 'book-bar');
  const fill = el('span', 'book-bar-fill');
  fill.style.width = `${total ? (100 * solved) / total : 0}%`;
  bar.append(fill);
  box.append(bar, el('small', null, `解いた ${solved} / ${total}`));
  return box;
}
