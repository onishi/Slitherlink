/**
 * 写真から問題を作る画面。
 * ① 写真の上で盤の四隅を合わせ、マス数を決める → ② 読み取った数字を直しながら、
 * 論理だけで解けるかを自動で確かめる → 遊ぶ／問題リストに入れる。
 */

import { loadPhoto, guessCorners, readClues, homography, project, rectify } from './image-reader.js';
import { encodePuzzle, MAX_SIZE } from '../core/puzzle.js';
import { rateImported } from '../core/difficulty-report.js';
import { DIFFICULTIES } from '../core/generator.js';
import { renderReport } from './puzzle-report.js';

const WORKER_URL = new URL('../worker/check-worker.js', import.meta.url);

export class PhotoImport {
  /**
   * @param {object} parts 画面の部品（index.html の photo-modal の中）
   * @param {object} handlers
   * @param {(puzzle:object)=>void} handlers.onPlay 確かめた問題で遊ぶ
   * @param {(puzzle:object)=>void} handlers.onSave 問題リストに入れる
   * @param {object} [handlers.saveText] 「入れる」ボタンの文言 { idle, done, message }（管理画面では問題集向けに変える）
   */
  constructor(parts, handlers) {
    Object.assign(this, parts);
    this.handlers = handlers;
    this.saveText = {
      idle: 'リストに入れる',
      done: 'リストに入れました',
      message: '問題リストに入れました。メニューの「問題リスト」から遊べます。',
      ...handlers.saveText,
    };
    this.photo = null;
    this.corners = null;
    this.clues = null;
    this.unsure = null;
    this.result = null;
    this.drag = -1;
    this.checkId = 0;
    this.timer = 0;
    try {
      this.worker = new Worker(WORKER_URL, { type: 'module' });
      this.worker.onmessage = (ev) => (ev.data.type === 'repair' ? this._onRepair(ev.data) : this._onChecked(ev.data));
    } catch {
      this.worker = null; // ワーカーが使えなければ画面の側で確かめる
    }
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (ev) => {
      const p = this._toImage(ev);
      let best = -1;
      let bestDist = (this._handleRadius() * 2.2) ** 2;
      this.corners.forEach(([x, y], i) => {
        const d = (x - p[0]) ** 2 + (y - p[1]) ** 2;
        if (d < bestDist) { bestDist = d; best = i; }
      });
      if (best < 0) return;
      ev.preventDefault();
      c.setPointerCapture(ev.pointerId);
      this.drag = best;
    });
    c.addEventListener('pointermove', (ev) => {
      if (this.drag < 0) return;
      const [x, y] = this._toImage(ev);
      this.corners[this.drag] = [
        Math.max(0, Math.min(this.photo.width, x)),
        Math.max(0, Math.min(this.photo.height, y)),
      ];
      this._draw();
    });
    const end = () => { this.drag = -1; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    for (const input of [this.rowsInput, this.colsInput]) input.addEventListener('input', () => this._draw());
    this.readBtn.addEventListener('click', () => this._read());
    this.backBtn.addEventListener('click', () => this._step('align'));
    this.playBtn.addEventListener('click', () => this.result && this.handlers.onPlay(this.result));
    this.saveBtn.addEventListener('click', () => {
      if (!this.result) return;
      if (this.handlers.onSave(this.result) === false) return; // ログインを待つ
      this._setSaved(true);
      this.status.textContent = this.saveText.message;
    });
    this.closeBtn.addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (ev) => { if (ev.target === this.modal) this.close(); });
  }

  /** 写真を受け取って、四隅合わせの画面を開く。 */
  async open(file) {
    this.modal.hidden = false;
    this._step('align');
    this.status.textContent = '';
    try {
      this.photo = await loadPhoto(file);
    } catch (err) {
      this.close();
      throw err;
    }
    const guess = guessCorners(this.photo);
    this.corners = guess.corners;
    if (guess.rows) this.rowsInput.value = guess.rows;
    if (guess.cols) this.colsInput.value = guess.cols;
    this.canvas.width = this.photo.width;
    this.canvas.height = this.photo.height;
    this._draw();
  }

  /** ログインを待ってから入れたときに、入れたあとの見た目にする。 */
  markSaved() {
    this._setSaved(true);
    this.status.textContent = this.saveText.message;
  }

  /** 「リストに入れる」を、入れたあとの見た目（色・チェック・文言）にする／戻す。 */
  _setSaved(saved) {
    const b = this.saveBtn;
    if (b.classList.contains('is-saved') === saved) return;
    b.classList.toggle('is-saved', saved);
    b.querySelector('.mi').textContent = saved ? 'bookmark_added' : 'bookmark_add';
    b.querySelector('.photo-save-label').textContent = saved ? this.saveText.done : this.saveText.idle;
    if (saved) b.disabled = true; // 同じ問題を何度も入れない
  }

  close() {
    this.modal.hidden = true;
    this.photo = null;
  }

  get rows() { return clampSize(this.rowsInput.value); }
  get cols() { return clampSize(this.colsInput.value); }

  _step(name) {
    this.alignStep.hidden = name !== 'align';
    this.editStep.hidden = name !== 'edit';
  }

  _handleRadius() {
    return Math.max(this.photo.width, this.photo.height) / 45;
  }

  _toImage(ev) {
    const rect = this.canvas.getBoundingClientRect();
    return [
      ((ev.clientX - rect.left) / rect.width) * this.photo.width,
      ((ev.clientY - rect.top) / rect.height) * this.photo.height,
    ];
  }

  /** 写真に、四隅の丸と、マス目の見当の線を重ねて描く。 */
  _draw() {
    if (!this.photo) return;
    const ctx = this.canvas.getContext('2d');
    ctx.drawImage(this.photo.canvas, 0, 0);
    const rows = this.rows;
    const cols = this.cols;
    const H = homography(this.corners, rows, cols);
    const lw = Math.max(1.5, this.photo.width / 500);
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(47, 111, 94, 0.85)';
    ctx.beginPath();
    for (let r = 0; r <= rows; r++) {
      const [x0, y0] = project(H, 0, r);
      const [x1, y1] = project(H, cols, r);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    for (let c = 0; c <= cols; c++) {
      const [x0, y0] = project(H, c, 0);
      const [x1, y1] = project(H, c, rows);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    const rad = this._handleRadius();
    for (const [x, y] of this.corners) {
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(224, 160, 32, 0.35)';
      ctx.fill();
      ctx.lineWidth = lw * 1.5;
      ctx.strokeStyle = '#e0a020';
      ctx.stroke();
    }
  }

  _read() {
    const { clues, unsure, conf, alts } = readClues(this.photo, this.corners, this.rows, this.cols);
    this.clues = clues;
    this.unsure = unsure;
    this.conf = conf;
    this.alts = alts;
    this._step('edit');
    this._renderGrid();
    this._check();
  }

  /** 読み取った盤を、押して直せるマス目として描く。 */
  _renderGrid() {
    const rows = this.rows;
    const cols = this.cols;
    this.grid.textContent = '';
    this.grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    this.grid.style.setProperty('--photo-cols', cols);
    // 写真（ゆがみを戻したもの）を下に敷き、読み取った数字をマスの隅に重ねて見比べられるようにする
    this.grid.style.backgroundImage = `url(${rectify(this.photo, this.corners, rows, cols).toDataURL('image/jpeg', 0.85)})`;
    this.paints = [];
    for (let i = 0; i < rows * cols; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'photo-cell';
      const paint = () => {
        b.textContent = '';
        if (this.clues[i] >= 0) {
          const badge = document.createElement('span');
          badge.className = 'photo-read';
          badge.textContent = String(this.clues[i]);
          b.appendChild(badge);
        }
        b.classList.toggle('unsure', this.unsure[i]);
        b.classList.remove('suggest');
        b.setAttribute('aria-label', `${Math.floor(i / cols) + 1}行${(i % cols) + 1}列 ${this.clues[i] < 0 ? '空白' : this.clues[i]}`);
      };
      b.addEventListener('click', () => {
        this.clues[i] = this.clues[i] >= 3 ? -1 : this.clues[i] + 1;
        this.unsure[i] = false;
        this.conf[i] = 1; // 利用者が決めたマスは、直す候補にしない
        paint();
        this._check();
      });
      paint();
      this.paints.push(paint);
      this.grid.appendChild(b);
    }
  }

  /** 論理だけで解けるかを確かめる（直すたびに、少し待ってから）。 */
  _check() {
    clearTimeout(this.timer);
    this.result = null;
    this.playBtn.disabled = true;
    this.saveBtn.disabled = true;
    this._setSaved(false); // 数字を直したら別の問題なので、また入れられる
    this.status.className = 'photo-status';
    this.status.textContent = '論理だけで解けるかを確かめています…';
    this.report.hidden = true;
    this.report.textContent = '';
    for (const el of this.grid.querySelectorAll('.suggest')) el.classList.remove('suggest');
    const id = ++this.checkId;
    const rows = this.rows;
    const cols = this.cols;
    const clues = Array.from(this.clues);
    this.timer = setTimeout(() => {
      if (this.worker) this.worker.postMessage({ id, rows, cols, clues });
      else {
        const puzzle = { rows, cols, difficulty: 'normal', clues: Int8Array.from(clues) };
        const r = rateImported(puzzle);
        const difficulty = r.difficulty ?? 'normal';
        this._onChecked({
          id, ok: true, status: r.status, difficulty, clueCount: r.clueCount, report: r.report,
          solution: r.solution ? Array.from(r.solution) : null, code: encodePuzzle({ ...puzzle, difficulty }),
        });
      }
    }, 300);
  }

  _onChecked(msg) {
    if (msg.id !== this.checkId) return; // もっと新しい直しが入っている
    if (!msg.ok) {
      this.status.textContent = `確かめられませんでした（${msg.error}）`;
      return;
    }
    const s = this.status;
    if (msg.status === 'ok') {
      this.result = {
        rows: this.rows, cols: this.cols, difficulty: msg.difficulty, code: msg.code,
        clues: Int8Array.from(this.clues), solution: Int8Array.from(msg.solution), clueCount: msg.clueCount,
        report: msg.report,
      };
      s.className = 'photo-status ok';
      s.textContent = `論理だけで解けます（答えは 1 つ）・数字 ${msg.clueCount} 個。むずかしさ: `;
      // 「ふつう」などのひとことを押すと、遊んでいるときの「この問題の難易度」と同じくわしい分析を開く
      const level = DIFFICULTIES[msg.difficulty];
      if (msg.report) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'report-link';
        link.setAttribute('aria-expanded', 'false');
        link.setAttribute('aria-controls', this.report.id);
        link.textContent = `「${level?.label ?? ''}」くわしく`;
        link.addEventListener('click', () => {
          const open = this.report.hidden;
          if (open && !this.report.childElementCount) renderReport(this.report, msg.report);
          this.report.hidden = !open;
          link.setAttribute('aria-expanded', String(open));
        });
        s.append(link);
      } else {
        s.append(`${level?.label ?? ''}（${level?.about ?? ''}）`);
      }
      this.playBtn.disabled = false;
      this.saveBtn.disabled = false;
    } else if (msg.status === 'contradiction') {
      s.className = 'photo-status warn';
      s.textContent = '数字どうしが矛盾していて、答えがありません。読み取りの間違い（点線のマスなど）を直してください。';
      this._askRepair(msg.id);
    } else {
      s.className = 'photo-status warn';
      s.textContent = '論理だけでは解き切れません（答えが複数あるか、当てずっぽうが要ります）。読み取りの間違いや抜けている数字が無いか確かめてください。';
      this._askRepair(msg.id);
    }
  }

  /** 自信の低いマスを次に近い数字へ変えると解けるかを、ワーカーで探す。 */
  _askRepair(id) {
    if (!this.worker) return;
    const candidates = [];
    this.clues.forEach((v, i) => {
      if (v >= 0 && this.alts[i] >= 0 && this.alts[i] !== v && this.conf[i] < 0.995) candidates.push([i, this.alts[i], this.conf[i]]);
    });
    candidates.sort((a, b) => a[2] - b[2]);
    if (!candidates.length) return;
    this.worker.postMessage({
      type: 'repair', id, rows: this.rows, cols: this.cols, clues: Array.from(this.clues),
      candidates: candidates.slice(0, 8).map(([i, to]) => [i, to]),
    });
  }

  _onRepair(msg) {
    if (msg.id !== this.checkId || !msg.found) return;
    const { cell, from, to } = msg.found;
    const cols = this.cols;
    const where = `${Math.floor(cell / cols) + 1}行${(cell % cols) + 1}列`;
    const p = document.createElement('span');
    p.className = 'photo-repair';
    p.append(`${where}の ${from} を ${to} にすると、論理だけで解けます。`);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${to} に直す`;
    btn.addEventListener('click', () => {
      this.clues[cell] = to;
      this.unsure[cell] = false;
      this.conf[cell] = 1;
      this.paints[cell]();
      this._check();
    });
    p.appendChild(btn);
    this.status.appendChild(p);
    this.grid.children[cell]?.classList.add('suggest');
  }
}

function clampSize(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(2, Math.min(MAX_SIZE, n)) : 10;
}
