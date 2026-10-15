/**
 * Google アカウントでのログインと、サーバーとのやりとり。
 *
 * ログインすると、問題リスト・解いた履歴・自己ベスト・途中の盤面をサーバーに持ち、
 * どの端末からでも同じものが見える。端末の localStorage は、その写しとして使う（すぐ出すため）。
 * 初めてログインしたときは、その端末にあったゲストのデータをアカウントに取り込む。
 */

import { store } from './storage.js';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

async function api(path, { method = 'GET', body, keepalive = false } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    keepalive,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 中身なし */ }
  if (!res.ok) {
    const err = new Error(data?.error || `通信できませんでした (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** 書き込みをサーバーへ送る口（storage.js が使う）。失敗しても画面は止めない。 */
const remote = {
  addLibrary: (entry) => api('/api/library', { method: 'POST', body: { entry } }),
  removeLibrary: (code) => api(`/api/library?code=${encodeURIComponent(code)}`, { method: 'DELETE' }),
  addHistory: (entry) => api('/api/history', { method: 'POST', body: entry }),
  saveGame: (game, keepalive) => api('/api/game', { method: 'PUT', body: { game, updatedAt: game.updatedAt }, keepalive }),
  deleteGame: () => api('/api/game', { method: 'DELETE' }),
};

let gsiPromise = null;
function loadGsi() {
  gsiPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.onload = () => resolve(window.google?.accounts?.id);
    s.onerror = () => { gsiPromise = null; reject(new Error('Google のログイン画面を読み込めませんでした')); };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

export const account = {
  user: store.cachedUser(),
  clientId: null,
  ready: false,
  /** ログイン・ログアウト・同期のたびに呼ぶ（app.js が画面を描き直す）。 */
  onChange: () => {},
  /** サーバーの途中の盤面が、この端末のものより新しかったとき。 */
  onRemoteGame: () => {},
  /** ログインできたあとにしたいこと（「リストに入れる」など）。 */
  pending: null,
  _gsiReady: false,

  get loggedIn() { return !!this.user; },

  /** 起動時に、設定とログイン状態を確かめる。サーバーが無い（静的ファイルだけの）環境ではゲストのまま。 */
  async init() {
    if (this.user) store.useRemote(remote);
    try {
      const [config, me] = await Promise.all([api('/api/config'), api('/api/me')]);
      this.clientId = config?.googleClientId || null;
      if (me?.user) {
        this._setUser(me.user);
        await this.sync();
      } else if (this.user) {
        this._setUser(null); // セッションが切れていた
      }
    } catch {
      // サーバーにつながらないときは、覚えている写しで続ける
    }
    this.ready = true;
    this.onChange();
  },

  _setUser(user) {
    this.user = user;
    store.setUser(user);
    store.useRemote(user ? remote : null);
  },

  /** サーバーの内容を、この端末の写しへ入れる。 */
  async sync() {
    const data = await api('/api/data');
    const before = store.game();
    store.applyServer(data);
    const after = store.game();
    if (after && (!before || (after.updatedAt ?? 0) > (before.updatedAt ?? 0))) this.onRemoteGame(after);
    this.onChange();
  },

  /** Google のボタンを container に描く。クライアント ID が無いあいだは、準備中と出す。 */
  async renderButton(container) {
    container.textContent = '';
    if (!this.ready) {
      container.append(note('ログインの準備をしています…'));
      return;
    }
    if (!this.clientId) {
      container.append(note('ログインはまだ準備中です。'));
      return;
    }
    try {
      const gsi = await loadGsi();
      if (!this._gsiReady) {
        gsi.initialize({
          client_id: this.clientId,
          callback: (res) => this._onCredential(res.credential),
          ux_mode: 'popup',
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        this._gsiReady = true;
      }
      gsi.renderButton(container, {
        theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large', text: 'signin_with', shape: 'pill', locale: 'ja',
        width: Math.min(320, Math.max(200, container.clientWidth || 280)),
      });
    } catch (err) {
      container.textContent = '';
      container.append(note(err.message));
    }
  },

  async _onCredential(credential) {
    try {
      const res = await api('/api/login', { method: 'POST', body: { credential } });
      this._setUser(res.user);
      if (res.needsImport) {
        // 初めてのログイン：この端末にあったゲストのデータをアカウントへ
        await api('/api/import', { method: 'POST', body: store.guestData() }).catch(() => {});
      }
      await this.sync();
      const then = this.pending;
      this.pending = null;
      then?.();
    } catch (err) {
      this.onChange(err);
    }
  },

  async logout() {
    store.flushGame();
    try { await api('/api/logout', { method: 'POST', body: {} }); } catch { /* 手元だけでも抜ける */ }
    window.google?.accounts?.id?.disableAutoSelect();
    this._setUser(null);
    store.clearAccountCopy();
    this.onChange();
  },
};

function note(text) {
  const p = document.createElement('p');
  p.className = 'login-note';
  p.textContent = text;
  return p;
}
