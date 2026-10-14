/**
 * いま使える定石を、ヒントと同じ場所にカードで並べる。左右にスワイプして切り替える。
 * カードを見ただけでは盤面のどこに効くかは出さない（自分で探せるように）。
 * 「候補」を押すと onReveal で知らせるので、当てはまる位置と決まる印を光らせられる。
 */

import { renderPattern } from './pattern-render.js';
import { combinesText } from '../core/patterns.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export class PatternCards {
  /**
   * @param {object} parts
   * @param {HTMLElement} parts.track 横にスクロールする入れ物
   * @param {HTMLElement} parts.position 「2 / 6」を出す場所
   * @param {HTMLButtonElement} parts.prev
   * @param {HTMLButtonElement} parts.next
   * @param {(item:object)=>void} parts.onApply 「当てはめる」を押したとき
   * @param {(item:object|null)=>void} parts.onReveal 「候補」で位置を出す（null で消す）
   * @param {()=>void} parts.onClose 「やめる」を押したとき
   * @param {(item:object|null)=>void} parts.onFocus 見ているカードが変わったとき
   * @param {Array<{label:string, run:()=>void}>} parts.emptyActions 使える定石が無いときのボタン
   */
  constructor(parts) {
    Object.assign(this, parts);
    this.items = [];
    this.index = 0;
    this.focusedId = null;
    this.revealedId = null;
    let frame = 0;
    this.track.addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => this._sync());
    });
    this.prev.addEventListener('click', () => this.go(this.index - 1));
    this.next.addEventListener('click', () => this.go(this.index + 1));
    this.track.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); this.go(this.index - 1); }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); this.go(this.index + 1); }
    });
  }

  /**
   * カードを並べ直す。keep に定石 id を渡すと、まだ使えるならそのカードを開いたままにする。
   * @param {Array<{pattern:object, fills:object[], places:number}>} items
   */
  render(items, keep = this.focusedId) {
    this.items = items;
    this.track.textContent = '';
    if (!items.length) {
      const empty = el('div', 'pc-card pc-empty');
      empty.append(el('p', null, 'いまの盤面で使える定石はありません。'));
      const row = el('div', 'pc-empty-actions');
      for (const action of this.emptyActions) {
        const b = el('button', null, action.label);
        b.type = 'button';
        b.addEventListener('click', action.run);
        row.appendChild(b);
      }
      empty.appendChild(row);
      this.track.appendChild(empty);
    }
    for (const item of items) this.track.appendChild(this._card(item));

    const found = items.findIndex((item) => item.pattern.id === keep);
    this.index = found >= 0 ? found : 0;
    this.track.scrollLeft = this.index * this.track.clientWidth;
    this._update(true);
  }

  go(i) {
    if (!this.items.length) return;
    const index = Math.max(0, Math.min(this.items.length - 1, i));
    this.track.scrollTo({ left: index * this.track.clientWidth, behavior: 'smooth' });
    this.index = index;
    this._update();
  }

  _sync() {
    const width = this.track.clientWidth || 1;
    const index = Math.round(this.track.scrollLeft / width);
    if (index !== this.index) {
      this.index = index;
      this._update();
    }
  }

  _update(force = false) {
    const n = this.items.length;
    this.position.textContent = n ? `${this.index + 1} / ${n}` : '';
    this.prev.disabled = this.index <= 0;
    this.next.disabled = this.index >= n - 1;
    this.prev.hidden = this.next.hidden = n <= 1;
    const item = this.items[this.index] ?? null;
    const id = item ? item.pattern.id : null;
    if (force || id !== this.focusedId) {
      this.focusedId = id;
      // 別のカードへ移ったら、出していた位置は消す
      this._setRevealed(null);
      this.onFocus(item);
    }
  }

  /** 「候補」の位置を出す・消す。 */
  _setRevealed(item) {
    const id = item ? item.pattern.id : null;
    if (id === this.revealedId && item) return;
    const had = this.revealedId !== null;
    this.revealedId = id;
    for (const b of this.track.querySelectorAll('.pc-reveal')) {
      const on = b.closest('.pc-card').dataset.id === id;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    if (item || had) this.onReveal(item);
  }

  _card(item) {
    const { pattern, fills, places } = item;
    const card = el('article', 'pc-card');
    card.dataset.id = pattern.id;
    // 定石名と「N か所」は欄の見出しに出すので、カードには載せない（縦幅を抑える）
    card.setAttribute('aria-label', `${pattern.title}（${places} か所）`);

    const body = el('div', 'pc-body');
    const figure = el('div', 'pc-figure');
    figure.appendChild(renderPattern(pattern));
    const shortcut = combinesText(pattern);
    const why = el('p', 'pc-why', shortcut ? `${pattern.why} ${shortcut}` : pattern.why);
    // 説明は長いので畳んでおき、触ると全部出す
    why.addEventListener('click', () => why.classList.toggle('is-open'));
    body.append(figure, why);

    // 候補（位置を見る）・当てはめる・やめる
    const actions = el('div', 'pc-actions');
    const button = (className, iconName, label) => {
      const b = el('button', className);
      b.type = 'button';
      b.append(el('span', 'mi', iconName), label);
      b.firstChild.setAttribute('aria-hidden', 'true');
      return b;
    };
    const reveal = button('pc-reveal', 'location_searching', '候補');
    reveal.setAttribute('aria-pressed', 'false');
    reveal.title = '当てはまる位置を盤面に出す';
    reveal.addEventListener('click', () => this._setRevealed(this.revealedId === pattern.id ? null : item));
    const apply = button('primary pc-apply', 'done_all', `当てはめる（${fills.length} 本）`);
    apply.addEventListener('click', () => this.onApply(item));
    const close = button('pc-close', 'close', 'やめる');
    close.addEventListener('click', () => this.onClose());
    actions.append(reveal, apply, close);

    card.append(body, actions);
    return card;
  }
}
