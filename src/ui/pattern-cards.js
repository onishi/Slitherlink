/**
 * いま使える定石を、ヒントと同じ場所にカードで並べる。左右にスワイプして切り替える。
 * 見ているカードが変わると onFocus で知らせるので、盤面のどこに効くかを光らせられる。
 */

import { renderPattern } from './pattern-render.js';

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
   * @param {(item:object|null)=>void} parts.onFocus 見ているカードが変わったとき
   * @param {Array<{label:string, run:()=>void}>} parts.emptyActions 使える定石が無いときのボタン
   */
  constructor(parts) {
    Object.assign(this, parts);
    this.items = [];
    this.index = 0;
    this.focusedId = null;
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
      this.onFocus(item);
    }
  }

  _card(item) {
    const { pattern, fills, places } = item;
    const card = el('article', 'pc-card');
    card.dataset.id = pattern.id;

    const head = el('div', 'pc-head');
    head.append(el('h3', null, pattern.title), el('span', 'pc-count', `${places} か所`));

    const body = el('div', 'pc-body');
    const figure = el('div', 'pc-figure');
    figure.appendChild(renderPattern(pattern));
    const why = el('p', 'pc-why', pattern.why);
    // 説明は長いので畳んでおき、触ると全部出す
    why.addEventListener('click', () => why.classList.toggle('is-open'));
    body.append(figure, why);

    const apply = el('button', 'primary pc-apply', `当てはめる（${fills.length} 本決まる）`);
    apply.type = 'button';
    apply.addEventListener('click', () => this.onApply(item));

    card.append(head, body, apply);
    return card;
  }
}
