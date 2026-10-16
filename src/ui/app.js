import { getGrid, UNKNOWN, LINE, CROSS } from '../core/grid.js';
import { analyze, autoCrossEdges, findHints } from '../core/game.js';
import { decodePuzzle, encodePuzzle, solutionFor, samePuzzle } from '../core/puzzle.js';
import { DIFFICULTIES } from '../core/generator.js';
import { Board } from './board.js';
import { renderPatternsInto } from './patterns-view.js';
import { findMatches } from '../core/pattern-match.js';
import { PATTERNS } from '../core/patterns.js';
import { PuzzleService } from './puzzle-service.js';
import { PatternCards } from './pattern-cards.js';
import { PhotoImport } from './photo-import.js';
import { CameraCapture, needsCameraView } from './camera-capture.js';
import { PuzzleReport } from './puzzle-report.js';
import { store } from './storage.js';
import { account } from './account.js';
import { BookShelf } from './books.js';
import { renderHelpFigures } from './help-figures.js';

const $ = (id) => document.getElementById(id);

/** Material Symbols のアイコン（読み上げでは飛ばす）。 */
function icon(name) {
  const span = document.createElement('span');
  span.className = 'mi';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = name;
  return span;
}

const el = {
  puzzleReport: $('puzzle-report'),
  board: $('board'),
  size: $('sel-size'),
  difficulty: $('sel-difficulty'),
  newBtn: $('btn-new'),
  undo: $('btn-undo'),
  redo: $('btn-redo'),
  hint: $('btn-hint'),
  check: $('btn-check'),
  clear: $('btn-clear'),
  message: $('message'),
  overlay: $('overlay'),
  overlayCard: $('overlay-card'),
  autocross: $('opt-autocross'),
  errors: $('opt-errors'),
  fade: $('opt-fade'),
  code: $('puzzle-code'),
  copy: $('btn-copy'),
  load: $('btn-load'),
  rulesModal: $('rules-modal'),
  rulesBtn: $('btn-rules'),
  closeRules: $('btn-close-rules'),
  keysModal: $('keys-modal'),
  theme: $('btn-theme'),
  hintPanel: $('hint-panel'),
  hintBadge: $('hint-badge'),
  hintTitle: $('hint-title'),
  hintText: $('hint-text'),
  hintActions: $('hint-actions'),
  hintProof: $('hint-proof'),
  hintSteps: $('hint-steps'),
  hintClose: $('hint-close'),
  hintNav: $('hint-nav'),
  hintPrev: $('hint-prev'),
  hintNext: $('hint-next'),
  hintPos: $('hint-pos'),
  patternsBtn: $('btn-patterns'),
  quickPatterns: $('btn-quick-patterns'),
  zoomCtl: $('zoom-ctl'),
  photoCamera: $('photo-camera'),
  photoPick: $('photo-pick'),
  libraryList: $('library-list'),
  libraryCount: $('library-count'),
  historyList: $('history-list'),
  accountRow: $('account-row'),
  loginModal: $('login-modal'),
  loginReason: $('login-reason'),
  loginButton: $('login-google'),
  loginStatus: $('login-status'),
  reportSummary: $('report-summary'),
  saveCurrent: $('btn-save-current'),
  zoomIn: $('zoom-in'),
  zoomOut: $('zoom-out'),
  zoomFit: $('zoom-fit'),
  patPanel: $('pat-panel'),
  patTrack: $('pat-track'),
  patPos: $('pat-pos'),
  patPrev: $('pat-prev'),
  patNext: $('pat-next'),
  patClose: $('pat-panel-close'),
  rulesPatternsBtn: $('btn-rules-patterns'),
  drawer: $('patterns-drawer'),
  drawerBody: $('drawer-body'),
  drawerScrim: $('drawer-scrim'),
  drawerClose: $('btn-drawer-close'),
  modeLine: $('mode-line'),
  menuModal: $('menu-modal'),
  menuBtn: $('btn-menu'),
  closeMenu: $('btn-close-menu'),
  modeCross: $('mode-cross'),
};

const service = new PuzzleService();

const game = {
  puzzle: null,
  grid: null,
  state: null,
  undoStack: [],
  redoStack: [],
  pending: [],
  elapsed: 0,
  running: false,
  solved: false,
  lastTick: 0,
  busy: false,
};

let board;
let cards;
let messageTimer = 0;

/* ---------------- 起動 ---------------- */

function init() {
  const prefs = store.prefs();
  // savePrefs() がこの値を上書きする前に控えておく
  const wantDrawerOpen = prefs.drawer === true;
  patternsOnlyUsable = prefs.patternsOnlyUsable === true;
  if (prefs.size) el.size.value = prefs.size;
  if (prefs.difficulty) el.difficulty.value = prefs.difficulty;
  // 既定は「自動 × なし・矛盾表示なし・使い終わった数字は薄く」。
  // 一度でも触った設定は localStorage の値が優先される。
  el.autocross.checked = prefs.autocross === true;
  el.errors.checked = prefs.errors === true;
  el.fade.checked = prefs.fade !== false;
  if (prefs.theme) document.documentElement.dataset.theme = prefs.theme;

  board = new Board(el.board, {
    onPaint: paint,
    onStrokeEnd: commitStroke,
    onZoomChange: updateZoomControls,
  });
  cards = new PatternCards({
    track: el.patTrack,
    position: el.patPos,
    prev: el.patPrev,
    next: el.patNext,
    onApply: (item) => applyPattern(item.pattern),
    onReveal: revealPatternCard,
    onClose: () => hidePatterns(),
    onFocus: showPatternTitle,
    emptyActions: [
      { label: 'ヒントを見る', run: () => showHint() },
      { label: '定石の一覧', run: () => openDrawer() },
    ],
  });
  board.showErrors = el.errors.checked;
  board.fadeDone = el.fade.checked;
  setInputMode(prefs.inputMode === 'cross' ? 'cross' : 'line');

  bindUI();
  setupPhotoImport();
  setupAccount();
  if (wantDrawerOpen) openDrawer({ instant: true });

  const fromUrl = new URLSearchParams(location.search).get('p');
  // URL の問題が、途中まで解いて保存してある問題と同じなら、続きから
  const saved = store.game();
  if (fromUrl && saved?.code && samePuzzle(fromUrl, saved.code) && restoreSaved()) return;
  if (fromUrl && tryLoadCode(fromUrl, true)) { game.openedFromUrl = true; return; }
  if (restoreSaved()) return;
  newPuzzle();
}

function bindUI() {
  el.newBtn.addEventListener('click', () => { closeMenu(); newPuzzle(); });
  for (const select of [el.size, el.difficulty]) {
    select.addEventListener('change', () => { savePrefs(); prefetchCurrent(); });
  }

  // 完成後に「盤面を見る」で結果を閉じても、盤面をタップすればまた出せるようにする
  el.board.addEventListener('click', () => {
    if (game.solved && el.overlay.hidden) showOverlay(game.solvedBest);
  });

  el.undo.addEventListener('click', undo);
  el.redo.addEventListener('click', redo);
  el.hint.addEventListener('click', toggleHint);
  el.check.addEventListener('click', check);
  el.clear.addEventListener('click', () => { closeMenu(); clearBoard(); });

  el.autocross.addEventListener('change', () => {
    if (el.autocross.checked && game.grid && !game.solved) {
      applyZeroCrosses();
      refreshAll();
      persist();
    }
    savePrefs();
  });
  el.errors.addEventListener('change', () => {
    board.showErrors = el.errors.checked;
    board.rendered.fill(-1);
    board.refresh();
    savePrefs();
  });
  el.fade.addEventListener('change', () => {
    board.fadeDone = el.fade.checked;
    board.rendered.fill(-1);
    board.refresh();
    savePrefs();
  });

  el.copy.addEventListener('click', copyCode);
  el.load.addEventListener('click', () => { if (tryLoadCode(el.code.value, false)) closeMenu(); });
  el.code.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (tryLoadCode(el.code.value, false)) closeMenu();
    }
  });

  for (const btn of [el.modeLine, el.modeCross]) {
    btn.addEventListener('click', () => setInputMode(btn.dataset.mode));
  }

  el.patternsBtn.addEventListener('click', () => toggleDrawer());
  el.quickPatterns.addEventListener('click', () => (isPatternsOpen() ? hidePatterns() : showPatterns()));
  el.patClose.addEventListener('click', () => hidePatterns());
  el.zoomIn.addEventListener('click', () => board.zoomBy(1.5));
  el.zoomOut.addEventListener('click', () => board.zoomBy(1 / 1.5));
  el.zoomFit.addEventListener('click', () => board.resetZoom());
  // 盤面のほうを触りたいだけのときもあるので、開いたままでも遊べるようにしておく
  el.rulesPatternsBtn.addEventListener('click', () => {
    hidePanel(el.rulesModal, true);
    openDrawer();
  });
  // ✕ は「自分で考える」と同じ。説明を閉じて、盤面の光りも消す
  el.hintClose.addEventListener('click', () => { hideHint(); board.clearHints(); });
  el.hintProof.addEventListener('toggle', fitScreen);
  window.addEventListener('resize', fitScreen);
  el.hintPrev.addEventListener('click', () => showHintAt(hintIndex - 1));
  el.hintNext.addEventListener('click', () => showHintAt(hintIndex + 1));
  bindSwipe(el.hintPanel, (dir) => showHintAt(hintIndex + dir));
  el.drawerClose.addEventListener('click', () => closeDrawer());
  el.drawerScrim.addEventListener('click', () => closeDrawer());

  el.rulesBtn.addEventListener('click', () => {
    if (el.rulesModal.hidden) openRules(); else hidePanel(el.rulesModal);
  });
  $('btn-x-rules').addEventListener('click', () => hidePanel(el.rulesModal));
  // 右上の 3 つ（遊び方・定石一覧・メニュー）は、どれも右から出るパネル
  const topPatterns = $('btn-top-patterns');
  topPatterns.addEventListener('click', () => toggleDrawer());
  el.menuBtn.addEventListener('click', openMenu);
  el.closeMenu.addEventListener('click', closeMenu);
  for (const b of el.menuModal.querySelectorAll('[data-go]')) {
    b.addEventListener('click', () => {
      const view = b.dataset.go;
      // 問題集・問題リスト・解いた履歴はログインした人だけ
      if ((view === 'library' || view === 'history' || view === 'books') && !account.loggedIn) {
        const why = {
          books: '問題集で遊ぶには、ログインしてください。',
          library: '問題リストを使うには、ログインしてください。',
          history: '解いた履歴を残すには、ログインしてください。',
        }[view];
        requireLogin(why, () => { openMenu(); if (view === 'books') shelf().showList(); else showMenuView(view); });
        return;
      }
      if (view === 'books') shelf().showList();
      else showMenuView(view);
    });
  }
  for (const b of el.menuModal.querySelectorAll('[data-back]')) b.addEventListener('click', () => showMenuView('main'));
  for (const b of el.menuModal.querySelectorAll('[data-close]')) b.addEventListener('click', closeMenu);
  el.menuModal.addEventListener('click', (ev) => {
    if (ev.target === el.menuModal) closeMenu();
  });
  el.closeRules.addEventListener('click', () => hidePanel(el.rulesModal));
  el.rulesModal.addEventListener('click', (ev) => {
    if (ev.target === el.rulesModal) hidePanel(el.rulesModal);
  });
  el.theme.addEventListener('click', toggleTheme);

  // キーボード操作の一覧。Mac では Ctrl の代わりに ⌘ と書く
  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
    for (const k of el.keysModal.querySelectorAll('.kbd-mod')) k.textContent = '⌘';
    for (const m of el.keysModal.querySelectorAll('.mac-only')) m.hidden = false;
  }
  $('btn-rules-keys').addEventListener('click', () => {
    hidePanel(el.rulesModal, true);
    showPanel(el.keysModal);
  });
  $('btn-close-keys').addEventListener('click', () => hidePanel(el.keysModal));
  el.keysModal.addEventListener('click', (ev) => {
    if (ev.target === el.keysModal) hidePanel(el.keysModal);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      // 手前に重なっているものから閉じる
      if (camera?.isOpen) { camera.close(); return; }
      if (!el.keysModal.hidden) { hidePanel(el.keysModal); return; }
      if (!el.rulesModal.hidden) { hidePanel(el.rulesModal); return; }
      if (!el.loginModal.hidden) { closeLogin(); return; }
      if (isDrawerOpen()) { closeDrawer(); return; }
      if (!el.hintPanel.hidden) { hideHint(); board.clearHints(); return; }
      if (isPatternsOpen()) { hidePatterns(); return; }
      if (!el.menuModal.hidden) {
        // 奥の画面ならメニューの最初の画面へ、最初の画面なら閉じる
        if (menuView !== 'main') showMenuView('main'); else closeMenu();
        return;
      }
      hideOverlay();
    }
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && (ev.key === 'z' || ev.key === 'Z')) {
      ev.preventDefault();
      if (ev.shiftKey) redo(); else undo();
    } else if (mod && (ev.key === 'y' || ev.key === 'Y')) {
      ev.preventDefault();
      redo();
    } else if (!mod && !isTyping(ev.target) && (ev.key === 'h' || ev.key === 'H')) {
      ev.preventDefault();
      toggleHint();
    } else if (!mod && !isTyping(ev.target) && (ev.key === 'p' || ev.key === 'P')) {
      ev.preventDefault();
      if (isPatternsOpen()) hidePatterns(); else showPatterns();
    } else if (!mod && !isTyping(ev.target) && (ev.key === 'm' || ev.key === 'M')) {
      ev.preventDefault();
      setInputMode(board.inputMode === 'cross' ? 'line' : 'cross');
    } else if (!mod && !isTyping(ev.target) && ev.key === '?') {
      ev.preventDefault();
      if (el.keysModal.hidden) showPanel(el.keysModal); else hidePanel(el.keysModal);
    } else if (!mod && ev.key.startsWith('Arrow') && (ev.target === document.body || ev.target === document.documentElement)
      && !isAnyModalOpen()) {
      // どこにも焦点が無いときの矢印キーは、盤面に渡す（先に盤面をクリックしなくても動かせる）
      ev.preventDefault();
      el.board.focus();
      el.board.dispatchEvent(new KeyboardEvent('keydown', { key: ev.key, bubbles: false }));
    }
  });

  window.addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { tickTimer(); persist(); }
    else game.lastTick = Date.now();
  });

  setInterval(tickTimer, 1000);
}

/* ---------------- 設定とその他（めったに使わないもの） ---------------- */

let puzzleReport = null;
let menuView = 'main';
// メニューの「問題集」。どの問題集の何番を遊んでいるかも覚える（初めて使うときに作る）
let shelfInstance = null;
const shelf = () => (shelfInstance ??= new BookShelf({
  showView: showMenuView,
  play: (code) => tryLoadCode(code, false),
  closeMenu,
}));

function openMenu() {
  renderLibrary();
  renderHistory();
  renderAccount();
  puzzleReport ??= new PuzzleReport(el.puzzleReport, el.reportSummary);
  puzzleReport.show(game.puzzle);
  showPanel(el.menuModal);
  showMenuView('main');
}

/**
 * メニューの中の画面を切り替える。最初の画面には、よく使うものだけを置き、
 * 難易度のくわしい分析・問題リスト・問題コード・設定は、それぞれ奥の画面にする。
 */
function showMenuView(name) {
  menuView = name;
  for (const view of el.menuModal.querySelectorAll('.menu-view')) view.hidden = view.dataset.view !== name;
  el.menuModal.querySelector('.modal-card').scrollTop = 0;
  if (name === 'main') {
    // とじるボタンは最後にあるので、そこへ送られないようにする
    el.closeMenu.focus({ preventScroll: true });
  } else {
    el.menuModal.querySelector(`.menu-view[data-view="${name}"] .menu-sub-head .icon-btn`).focus({ preventScroll: true });
  }
}

/* ---------------- 右から出るパネル（遊び方・キーボード操作・メニュー） ---------------- */

function showPanel(panel) {
  panel.classList.remove('is-closing');
  panel.hidden = false;
}

/** 右へ引っ込めてから隠す。instant（別のパネルへ移るとき）や、動きを減らす設定なら、すぐ隠す。 */
function hidePanel(panel, instant = false) {
  if (panel.hidden) return;
  const done = () => { panel.classList.remove('is-closing'); panel.hidden = true; };
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
  panel.classList.add('is-closing');
  panel.querySelector('.modal-card').addEventListener('animationend', done, { once: true });
  setTimeout(() => { if (panel.classList.contains('is-closing')) done(); }, 400); // 念のため
}

function openRules() {
  renderHelpFigures(el.rulesModal); // 図は初めて開いたときに描く
  showPanel(el.rulesModal);
}

function closeMenu() {
  if (el.menuModal.hidden) return;
  hidePanel(el.menuModal);
  el.menuBtn.focus();
}



/* ---------------- ログイン（Google アカウント） ---------------- */

function setupAccount() {
  account.onChange = (err) => {
    renderAccount();
    if (!el.menuModal.hidden) { renderLibrary(); renderHistory(); }
    if (err) el.loginStatus.textContent = err.message;
    else if (account.loggedIn && !el.loginModal.hidden) closeLogin();
  };
  // ほかの端末で進めた盤面のほうが新しいとき：この端末でまだ手を動かしていなければ、それに切り替える
  account.onRemoteGame = () => {
    // 送られてきたリンク（?p=）で開いた問題は、そのままにする
    if (game.undoStack?.length || game.solved || game.openedFromUrl) return;
    if (restoreSaved()) say('ほかの端末で進めていた続きを開きました');
  };
  $('btn-close-login').addEventListener('click', closeLogin);
  el.loginModal.addEventListener('click', (ev) => { if (ev.target === el.loginModal) closeLogin(); });
  account.init();
}

/** ログインを促す画面を出す。ログインできたら then を続けて行う。 */
function requireLogin(reason, then) {
  account.pending = then ?? null;
  el.loginReason.textContent = reason;
  el.loginStatus.textContent = '';
  el.loginModal.hidden = false;
  account.renderButton(el.loginButton);
}

function closeLogin() {
  el.loginModal.hidden = true;
  account.pending = null;
}

/** メニューのいちばん上：ゲストならログインのボタン、ログイン中なら名前とログアウト。 */
function renderAccount() {
  const row = el.accountRow;
  if (!row) return;
  row.textContent = '';
  if (account.loggedIn) {
    const u = account.user;
    const who = document.createElement('span');
    who.className = 'account-who';
    if (u.picture) {
      const img = document.createElement('img');
      img.src = u.picture;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.className = 'account-avatar';
      who.appendChild(img);
    } else {
      who.appendChild(icon('account_circle'));
    }
    const text = document.createElement('span');
    text.className = 'account-text';
    const name = document.createElement('b');
    name.textContent = u.name || u.email || 'ログイン中';
    const sub = document.createElement('small');
    sub.textContent = 'リスト・履歴・途中の盤面をどの端末でも';
    text.append(name, sub);
    who.appendChild(text);
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'account-logout';
    out.textContent = 'ログアウト';
    out.addEventListener('click', () => account.logout());
    row.append(who, out);
  } else {
    const text = document.createElement('p');
    text.className = 'account-guest';
    text.textContent = 'ゲストで遊んでいます。ログインすると、問題リストと解いた履歴が使え、途中の盤面もどの端末からでも続けられます。';
    const btn = document.createElement('div');
    btn.className = 'account-google';
    row.append(text, btn);
    account.pending = null;
    account.renderButton(btn);
  }
}

/** メニューの「解いた履歴」を描く。 */
function renderHistory() {
  if (!el.historyList) return;
  const list = store.history();
  el.historyList.textContent = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'library-empty';
    li.textContent = 'まだありません。解き終えた問題がここに残ります。';
    el.historyList.appendChild(li);
    return;
  }
  for (const h of list) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'library-label';
    const d = new Date(h.solvedAt);
    const text = document.createElement('span');
    text.className = 'library-text';
    const main = document.createElement('b');
    main.textContent = `${h.rows}×${h.cols} ${DIFFICULTIES[h.difficulty]?.label ?? ''}・${formatTime(h.seconds)}`;
    const sub = document.createElement('small');
    const time = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    sub.textContent = `${time}${h.hints ? `・ヒント ${h.hints} 回` : '・ヒントなし'}`;
    text.append(main, sub);
    label.append(icon('task_alt'), text);
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'with-icon';
    play.append(icon('replay'), 'もう一度');
    play.addEventListener('click', () => { if (tryLoadCode(h.code, false)) closeMenu(); });
    li.append(label, play);
    el.historyList.appendChild(li);
  }
}

/* ---------------- 写真から作問・問題リスト ---------------- */

let photoImport = null;
let camera = null;

/** 撮った・選んだ写真で、四隅合わせの画面を開く。 */
async function openPhoto(file) {
  try {
    await photoImport.open(file);
  } catch (err) {
    say(err.message || '画像を読み込めませんでした', true);
  }
}

function setupPhotoImport() {
  photoImport = new PhotoImport({
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
    onPlay: (p) => {
      photoImport.close();
      // 確かめのときに調べた分析を、メニューの「この問題の難易度」でもそのまま使う
      puzzleReport ??= new PuzzleReport(el.puzzleReport, el.reportSummary);
      puzzleReport.remember(p, p.report);
      startChecked(p);
      // 写真から作って遊び始めた問題は、ログイン中なら問題リストに自動で入れる
      if (account.loggedIn) {
        keepInLibrary(p, 'photo');
        say('写真から作った問題です（問題リストに入れました）');
      } else {
        say('写真から作った問題です');
      }
    },
    onSave: (p) => {
      // 問題リストはログインした人だけ。ログインできたら、そのまま入れる
      if (!account.loggedIn) {
        requireLogin('問題リストに入れるには、ログインしてください。', () => {
          saveToLibrary(p, 'photo');
          photoImport.markSaved();
        });
        return false;
      }
      saveToLibrary(p, 'photo');
      return true;
    },
  });
  for (const input of [el.photoCamera, el.photoPick]) {
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      closeMenu();
      openPhoto(file);
    });
  }
  // パソコンでは capture 指定が効かずファイル選びになるので、カメラの映像を出して撮る
  camera = new CameraCapture({
    modal: $('camera-modal'),
    video: $('camera-video'),
    status: $('camera-status'),
    select: $('camera-select'),
    selectRow: $('camera-select-row'),
    shootBtn: $('camera-shoot'),
    cancelBtn: $('camera-cancel'),
  }, openPhoto);
  el.photoCamera.closest('label').addEventListener('click', (ev) => {
    if (!needsCameraView()) return;
    ev.preventDefault();
    closeMenu();
    camera.open();
  });
  el.saveCurrent.addEventListener('click', () => {
    if (!game.puzzle) return;
    saveToLibrary(game.puzzle, 'saved');
    renderLibrary();
  });
}

/** 確かめ済み（解が分かっている）問題を始める。 */
function startChecked(p) {
  ensureSizeOption(`${p.rows}x${p.cols}`);
  el.size.value = `${p.rows}x${p.cols}`;
  el.difficulty.value = p.difficulty;
  startPuzzle({ ...p, code: p.code || encodePuzzle(p), clueCount: countClues(p.clues) });
}

/**
 * 問題リストに入れる（すでに入っていれば先頭へ）。入っていたときの出どころと、解いた記録は引き継ぐ。
 * solved を渡すと、解いた日時（初めて解いたとき）といちばん速い時間を残す。
 */
function keepInLibrary(p, source, solved) {
  const code = p.code || encodePuzzle(p);
  const prev = store.library().find((e) => e.code === code || samePuzzle(e.code, code));
  const entry = {
    code, rows: p.rows, cols: p.cols, difficulty: p.difficulty, clueCount: countClues(p.clues),
    source: prev?.source ?? source,
  };
  const solvedAt = prev?.solvedAt ?? (solved ? Date.now() : undefined);
  const seconds = [prev?.seconds, solved?.seconds].filter((x) => Number.isFinite(x));
  if (solvedAt) entry.solvedAt = solvedAt;
  if (seconds.length) entry.seconds = Math.min(...seconds);
  store.saveToLibrary(entry);
}

function saveToLibrary(p, source) {
  keepInLibrary(p, source);
  say('問題リストに入れました');
}

/** メニューの「問題リスト」を描く。 */
function renderLibrary() {
  const list = store.library();
  el.libraryCount.textContent = list.length ? `${list.length} 問` : '';
  el.libraryList.textContent = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'library-empty';
    li.textContent = 'まだありません。写真から作って遊んだ問題や、解いた問題が自動で入ります。気に入った問題も入れておけます。';
    el.libraryList.appendChild(li);
    return;
  }
  for (const entry of list) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'library-label';
    const date = new Date(entry.addedAt);
    const text = document.createElement('span');
    text.className = 'library-text';
    const main = document.createElement('b');
    main.textContent = `${entry.rows}×${entry.cols} ${DIFFICULTIES[entry.difficulty]?.label ?? ''}`;
    const sub = document.createElement('small');
    const solved = entry.solvedAt ? `・解いた${Number.isFinite(entry.seconds) ? ` ${formatTime(entry.seconds)}` : ''}` : '';
    sub.textContent = `数字 ${entry.clueCount}・${date.getMonth() + 1}/${date.getDate()}${entry.source === 'photo' ? '・写真から' : ''}${solved}`;
    text.append(main, sub);
    label.append(icon(entry.source === 'photo' ? 'photo_camera' : entry.solvedAt ? 'check_circle' : 'bookmark'), text);
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'with-icon';
    play.append(icon('play_arrow'), '遊ぶ');
    play.addEventListener('click', () => { if (tryLoadCode(entry.code, false)) closeMenu(); });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn';
    remove.setAttribute('aria-label', 'リストから外す');
    remove.appendChild(icon('delete'));
    remove.addEventListener('click', () => { store.removeFromLibrary(entry.code); renderLibrary(); });
    li.append(label, play, remove);
    el.libraryList.appendChild(li);
  }
}

/* ---------------- 定石ドロワー ---------------- */

let patternsView = null;
// 「いま使える定石だけ表示」の状態（init で保存値を読む）
let patternsOnlyUsable = false;
// 閉じるアニメーションの途中でも正しく答えたいので、DOM ではなくこの変数で持つ
let drawerOpen = false;

function isDrawerOpen() {
  return drawerOpen;
}

function openDrawer({ instant = false } = {}) {
  if (drawerOpen) return;
  drawerOpen = true;
  if (!patternsView) {
    // 図の数が多いので、初めて開いたときにだけ作る
    patternsView = renderPatternsInto(el.drawerBody, {
      onApply: applyPattern,
      onlyUsable: patternsOnlyUsable,
      onFilterChange: (on) => { patternsOnlyUsable = on; savePrefs(); },
    });
  }
  updatePatternCounts();
  el.drawer.hidden = false;
  el.drawerScrim.hidden = false;
  document.body.classList.add('drawer-open');
  el.patternsBtn.setAttribute('aria-expanded', 'true');
  $('btn-top-patterns').setAttribute('aria-expanded', 'true');

  if (instant) {
    // 読み込み直後にスライドが走ると落ち着かないので、初回だけ動かさない
    document.body.classList.add('no-anim');
    el.drawer.classList.add('is-open');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => document.body.classList.remove('no-anim'));
    });
  } else {
    // hidden を外した直後だと transition が効かないので 1 フレーム待つ
    requestAnimationFrame(() => el.drawer.classList.add('is-open'));
    el.drawerClose.focus();
  }
  savePrefs();
}

function closeDrawer() {
  if (!drawerOpen) return;
  drawerOpen = false;
  el.drawer.classList.remove('is-open');
  el.drawerScrim.hidden = true;
  document.body.classList.remove('drawer-open');
  el.patternsBtn.setAttribute('aria-expanded', 'false');
  $('btn-top-patterns').setAttribute('aria-expanded', 'false');
  // 一覧のボタンはカードの欄にあって隠れていることがあるので、定石ボタンへ戻す
  el.quickPatterns.focus();
  const done = () => { el.drawer.hidden = true; };
  const motion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (motion) done();
  else el.drawer.addEventListener('transitionend', done, { once: true });
  savePrefs();
}

function toggleDrawer() {
  if (isDrawerOpen()) closeDrawer();
  else openDrawer();
}

/** 各定石が、いまの盤面で何か所に当てはまるかを数え直す。 */
function updatePatternCounts() {
  if (!patternsView || !game.grid) return;
  const counts = new Map();
  for (const pattern of PATTERNS) {
    const { places } = findMatches(game.grid, game.puzzle.clues, game.state, pattern);
    counts.set(pattern.id, places);
  }
  patternsView.setCounts(counts);
}

/* ---------------- いま使える定石のカード（ヒントと同じ場所） ---------------- */

function isPatternsOpen() {
  return !el.patPanel.hidden;
}

/** いま使える定石を、出番の多い順に集める。 */
function usablePatterns() {
  const items = [];
  for (const pattern of PATTERNS) {
    const { fills, places } = findMatches(game.grid, game.puzzle.clues, game.state, pattern);
    if (fills.length) items.push({ pattern, fills, places });
  }
  return items;
}

function showPatterns() {
  if (!game.grid || game.solved) return;
  hideHint();
  el.patPanel.hidden = false;
  el.quickPatterns.setAttribute('aria-expanded', 'true');
  el.quickPatterns.classList.add('is-on');
  refreshPatternCards(null);
  fitScreen();
}

function hidePatterns() {
  if (el.patPanel.hidden) return;
  el.patPanel.hidden = true;
  el.quickPatterns.setAttribute('aria-expanded', 'false');
  el.quickPatterns.classList.remove('is-on');
  board.clearHints();
  fitScreen();
}

/** 盤面が変わったら数え直す。見ていたカードがまだ使えるなら、そのカードのまま。 */
function refreshPatternCards(keep) {
  const items = usablePatterns();
  cards.render(items, keep === undefined ? cards.focusedId : keep);
}

/** 欄の見出しに、見ているカードの定石名と当てはまる場所の数を出す。 */
function showPatternTitle(item) {
  const h2 = el.patPanel.querySelector('h2');
  if (!item) { h2.textContent = '定石'; return; }
  const title = document.createElement('span');
  title.className = 'pc-title';
  title.textContent = item.pattern.title;
  const count = document.createElement('span');
  count.className = 'pc-count';
  count.textContent = `${item.places} か所`;
  h2.replaceChildren(title, count);
}

/** 「候補」を押したカードの定石が当てはまる位置と、そこに入る線か × かを光らせる。 */
function revealPatternCard(item) {
  if (!item) { board.clearHints(); return; }
  board.setHints(item.fills.map((f) => f.edge), null, new Map(item.fills.map((f) => [f.edge, f.value])));
  board.ensureVisible(item.fills[0].edge);
}

/** 拡大・縮小のボタンを、いまの倍率に合わせる。拡大できない小さな盤では出さない。 */
function updateZoomControls(scale, max) {
  el.zoomCtl.hidden = max <= 1;
  el.zoomIn.disabled = scale >= max;
  el.zoomOut.disabled = scale <= 1;
  el.zoomFit.hidden = scale <= 1;
}

/** 定石を盤面じゅうに当てはめて、決まる印をまとめて引く。 */
function applyPattern(pattern) {
  if (game.solved) return;
  const { fills, conflicts } = findMatches(game.grid, game.puzzle.clues, game.state, pattern);

  if (fills.length === 0) {
    say(conflicts > 0
      ? `「${pattern.title}」に合わない印が盤面にあります。チェックを試してください`
      : `いまの盤面に「${pattern.title}」を当てはめられる場所はありません`, conflicts > 0);
    updatePatternCounts();
    return;
  }

  board.clearHints();
  startTimer();
  for (const { edge, value } of fills) applyChange(edge, value);
  commitStroke();
  refreshAll();
  // カードを開いているときは、次のカードの場所を光らせるので、ここでは光らせない
  if (!isPatternsOpen()) {
    board.setHints(fills.map((f) => f.edge));
    setTimeout(() => board.clearHints(), 1600);
  }

  const suffix = conflicts > 0 ? '（合わない場所も見つかりました。チェックを試してください）' : '';
  say(`「${pattern.title}」で ${fills.length} 本決まりました${suffix}`, conflicts > 0);
}

/** 文字入力中かどうか。入力欄ではショートカットを横取りしない。 */
function isAnyModalOpen() {
  return [...document.querySelectorAll('.modal')].some((m) => !m.hidden) || isDrawerOpen();
}

function isTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}

/** タップしたときの印の付き方を切り替える。 */
function setInputMode(mode) {
  const next = mode === 'cross' ? 'cross' : 'line';
  board.inputMode = next;
  board.updatePointerLook();
  el.modeLine.setAttribute('aria-checked', String(next === 'line'));
  el.modeCross.setAttribute('aria-checked', String(next === 'cross'));
  savePrefs();
}

function savePrefs() {
  store.savePrefs({
    size: el.size.value,
    difficulty: el.difficulty.value,
    autocross: el.autocross.checked,
    errors: el.errors.checked,
    fade: el.fade.checked,
    inputMode: board ? board.inputMode : 'line',
    drawer: isDrawerOpen(),
    patternsOnlyUsable,
    theme: document.documentElement.dataset.theme || '',
  });
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const current = root.dataset.theme || (dark ? 'dark' : 'light');
  root.dataset.theme = current === 'dark' ? 'light' : 'dark';
  savePrefs();
}

/* ---------------- 問題の読み込み ---------------- */

function currentSettings() {
  const [rows, cols] = el.size.value.split('x').map(Number);
  return { rows, cols, difficulty: el.difficulty.value };
}

function prefetchCurrent() {
  const { rows, cols, difficulty } = currentSettings();
  service.prefetch(rows, cols, difficulty);
}

async function newPuzzle() {
  if (game.busy) return;
  const { rows, cols, difficulty } = currentSettings();
  game.busy = true;
  el.newBtn.disabled = true;
  const slow = difficulty === 'expert' && rows * cols >= 100;
  const seq = game.loadSeq;
  const waiting = setTimeout(() => {
    if (game.loadSeq === seq) say(slow ? '「鬼」の問題を作っています（大きな盤では少し時間がかかります）…' : '問題を作っています…');
  }, 180);
  try {
    const puzzle = await service.get(rows, cols, difficulty);
    clearTimeout(waiting);
    // 作っているあいだに別の問題が開かれた（ほかの端末の続きなど）ときは、そちらを残す
    if (game.loadSeq !== seq) return;
    startPuzzle(puzzle);
    // 時間内に狙いの難易度が作れなかったときは、本当の難易度を知らせる
    say(puzzle.difficulty !== difficulty
      ? `「${DIFFICULTIES[difficulty].label}」が時間内に作れなかったので、「${DIFFICULTIES[puzzle.difficulty]?.label}」の問題にしました`
      : '');
  } catch (err) {
    clearTimeout(waiting);
    say(err.message || '問題を作れませんでした', true);
  } finally {
    game.busy = false;
    el.newBtn.disabled = false;
  }
}

function startPuzzle(puzzle, saved) {
  game.loadSeq = (game.loadSeq ?? 0) + 1;
  hideHint();
  hidePatterns();
  game.puzzle = puzzle;
  // メニューを開いたまま問題が変わったら、「この問題の難易度」も新しい問題に
  if (puzzleReport && !el.menuModal.hidden) puzzleReport.show(puzzle);
  game.grid = getGrid(puzzle.rows, puzzle.cols);
  game.state = saved?.state ?? new Int8Array(game.grid.edgeCount);
  game.undoStack = [];
  game.redoStack = [];
  game.pending = [];
  game.elapsed = saved?.elapsed ?? 0;
  game.hints = saved?.hints ?? 0;
  game.solved = false;
  game.running = false;
  game.lastTick = Date.now();

  if (!saved) applyZeroCrosses();
  board.setPuzzle(puzzle, game.state);
  fitScreen();
  updateZoomControls(board.zoom.scale, board.maxScale());
  board.setSolved(false);
  hideOverlay();
  el.code.value = puzzle.code || encodePuzzle(puzzle);
  showCodeInUrl(el.code.value);
  // 問題集の問題でなくなったら、問題集で遊んでいる状態を終える
  shelfInstance?.onPuzzleChanged(el.code.value);
  refreshAll();
  persist();
}

/** 0 のマスのまわりは最初から × にしておく (「自動で ×」が有効なときだけ)。 */
function applyZeroCrosses() {
  if (!el.autocross.checked) return;
  for (let cell = 0; cell < game.grid.cellCount; cell++) {
    if (game.puzzle.clues[cell] !== 0) continue;
    for (let k = 0; k < 4; k++) {
      const e = game.grid.cellEdges[cell * 4 + k];
      if (game.state[e] === UNKNOWN) game.state[e] = CROSS;
    }
  }
}

function restoreSaved() {
  const saved = store.game();
  if (!saved || !saved.code || !saved.edges) return false;
  try {
    const decoded = decodePuzzle(saved.code);
    const solution = saved.solution
      ? Int8Array.from(saved.solution)
      : solutionFor(decoded);
    if (!solution) return false;
    const grid = getGrid(decoded.rows, decoded.cols);
    if (saved.edges.length !== grid.edgeCount) return false;
    const state = new Int8Array(grid.edgeCount);
    for (let i = 0; i < grid.edgeCount; i++) {
      const v = saved.edges.charCodeAt(i) - 48;
      state[i] = v === LINE || v === CROSS ? v : UNKNOWN;
    }
    ensureSizeOption(`${decoded.rows}x${decoded.cols}`);
    el.size.value = `${decoded.rows}x${decoded.cols}`;
    el.difficulty.value = decoded.difficulty;
    startPuzzle({
      ...decoded,
      solution,
      code: encodePuzzle(decoded), // 以前の形式で保存されていても、短い形式にそろえる
      clueCount: countClues(decoded.clues),
    }, { state, elapsed: saved.elapsed || 0, hints: saved.hints || 0 });
    prefetchCurrent();
    return true;
  } catch {
    return false;
  }
}

function tryLoadCode(code, fromUrl) {
  try {
    const decoded = decodePuzzle(code);
    const solution = solutionFor(decoded);
    if (!solution) {
      say('この問題コードは論理だけでは解けないようです', true);
      return false;
    }
    ensureSizeOption(`${decoded.rows}x${decoded.cols}`);
    el.size.value = `${decoded.rows}x${decoded.cols}`;
    el.difficulty.value = decoded.difficulty;
    startPuzzle({
      ...decoded,
      solution,
      code: encodePuzzle(decoded),
      clueCount: countClues(decoded.clues),
    });
    say(fromUrl ? '' : (shelfInstance?.label() ?? '問題を読み込みました'));
    prefetchCurrent();
    return true;
  } catch (err) {
    say(err.message || '問題コードを読み込めませんでした', true);
    return false;
  }
}

function ensureSizeOption(value) {
  if ([...el.size.options].some((o) => o.value === value)) return;
  const [r, c] = value.split('x');
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = `${r} × ${c}`;
  el.size.appendChild(opt);
}

function countClues(clues) {
  let n = 0;
  for (let i = 0; i < clues.length; i++) if (clues[i] >= 0) n++;
  return n;
}

/* ---------------- 書き込み ---------------- */

function paint(edge, value) {
  if (game.solved) return;
  if (game.state[edge] === value) return;
  hideHint();
  board.clearHints();
  startTimer();
  applyChange(edge, value);

  if (value === LINE && el.autocross.checked) {
    for (const e of autoCrossEdges(game.grid, game.puzzle.clues, game.state, [edge])) {
      applyChange(e, CROSS);
    }
  }
  refreshAll();
}

function applyChange(edge, value) {
  const before = game.state[edge];
  if (before === value) return;
  game.state[edge] = value;
  game.pending.push([edge, before, value]);
}

function commitStroke() {
  if (game.pending.length === 0) return;
  game.undoStack.push(game.pending);
  if (game.undoStack.length > 400) game.undoStack.shift();
  game.redoStack.length = 0;
  game.pending = [];
  updateButtons();
  persist();
  checkSolved();
}

function undo() {
  if (game.pending.length) commitStroke();
  const entry = game.undoStack.pop();
  if (!entry) return;
  for (let i = entry.length - 1; i >= 0; i--) game.state[entry[i][0]] = entry[i][1];
  game.redoStack.push(entry);
  afterHistory();
}

function redo() {
  const entry = game.redoStack.pop();
  if (!entry) return;
  for (const [edge, , to] of entry) game.state[edge] = to;
  game.undoStack.push(entry);
  afterHistory();
}

function afterHistory() {
  hideHint();
  game.solved = false;
  board.setSolved(false);
  hideOverlay();
  board.clearHints();
  refreshAll();
  persist();
  checkSolved();
}

function clearBoard() {
  if (!game.state.some((v) => v !== UNKNOWN)) return;
  const entry = [];
  for (let e = 0; e < game.state.length; e++) {
    if (game.state[e] !== UNKNOWN) {
      entry.push([e, game.state[e], UNKNOWN]);
      game.state[e] = UNKNOWN;
    }
  }
  applyZeroCrosses();
  for (const change of entry) {
    if (game.state[change[0]] !== UNKNOWN) change[2] = game.state[change[0]];
  }
  game.undoStack.push(entry);
  game.redoStack.length = 0;
  game.solved = false;
  hideHint();
  board.setSolved(false);
  hideOverlay();
  refreshAll();
  persist();
  say('盤面を消しました。「もどす」で元に戻せます');
}

/* ---------------- 表示の更新 ---------------- */

function refreshAll() {
  board.refresh();
  const a = analyze(game.grid, game.puzzle.clues, game.state);
  updateButtons();
  // 全定石を数え直しても 1ms 未満なので、盤面が動くたびに更新してよい
  if (isDrawerOpen()) updatePatternCounts();
  if (isPatternsOpen()) refreshPatternCards();
  return a;
}

function updateButtons() {
  el.undo.disabled = game.undoStack.length === 0 && game.pending.length === 0;
  el.redo.disabled = game.redoStack.length === 0;
  el.hint.disabled = game.solved;
  el.check.disabled = game.solved;
}

function checkSolved() {
  const a = analyze(game.grid, game.puzzle.clues, game.state);
  if (!a.solved || game.solved) return;
  game.solved = true;
  game.running = false;
  tickTimer();
  board.setSolved(true);
  hideHint();
  hidePatterns();
  board.clearHints();
  board.cursor = -1;
  board.showCursor = false;
  board._drawCursor();
  updateButtons();

  const key = `${game.puzzle.rows}x${game.puzzle.cols}:${game.puzzle.difficulty}`;
  const isBest = store.saveRecord(key, game.elapsed);
  game.solvedBest = isBest; // 「盤面を見る」のあと、結果を出し直すときに使う
  // ログイン中は、解いた問題を履歴に残す（サーバーにも送る）
  store.addHistory({
    code: game.puzzle.code || encodePuzzle(game.puzzle),
    rows: game.puzzle.rows, cols: game.puzzle.cols, difficulty: game.puzzle.difficulty,
    seconds: game.elapsed, hints: game.hints ?? 0,
  });
  // 解いた問題は、ログイン中なら問題リストにも自動で入れる（解いた印と時間つき）
  if (account.loggedIn) keepInLibrary(game.puzzle, 'solved', { seconds: game.elapsed });
  store.clearGame();
  say('');
  // 完成した輪をひと目見せてからお知らせを出す
  setTimeout(() => { if (game.solved) showOverlay(isBest); }, 520);
}

function showOverlay(isBest) {
  const diff = DIFFICULTIES[game.puzzle.difficulty]?.label ?? '';
  el.overlayCard.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = '完成！';
  const big = document.createElement('p');
  big.className = 'big';
  big.textContent = formatTime(game.elapsed);
  const sub = document.createElement('p');
  sub.textContent = `${game.puzzle.rows} × ${game.puzzle.cols} ・ ${diff}`;
  el.overlayCard.append(h, big, sub);
  // 問題集で遊んでいるなら、どの問題集の何番かと、次の問題へ進むボタン
  const bookLabel = shelfInstance?.label();
  if (bookLabel) {
    const next = shelfInstance.onSolved({ seconds: game.elapsed, hints: game.hints ?? 0 });
    const where = document.createElement('p');
    where.className = 'overlay-book';
    where.append(icon('menu_book'), bookLabel);
    el.overlayCard.appendChild(where);
    const row = document.createElement('div');
    row.className = 'row';
    const go = document.createElement('button');
    go.className = 'primary';
    if (next == null) {
      go.textContent = '問題集を見る';
      where.append('・ぜんぶ解きました！');
      go.addEventListener('click', () => { hideOverlay(); openMenu(); shelfInstance.openCurrent(); });
    } else {
      go.textContent = '次の問題へ';
      go.addEventListener('click', () => { hideOverlay(); shelfInstance.playNext(next); });
    }
    const list = document.createElement('button');
    list.textContent = next == null ? '盤面を見る' : '問題集を見る';
    list.addEventListener('click', () => {
      hideOverlay();
      if (next != null) { openMenu(); shelfInstance.openCurrent(); }
    });
    row.append(go, list);
    el.overlayCard.appendChild(row);
    el.overlay.hidden = false;
    go.focus();
    return;
  }
  const b = document.createElement('p');
  b.className = 'best';
  if (isBest) b.append(icon('emoji_events'), '自己ベスト更新！');
  else {
    const best = store.records()[`${game.puzzle.rows}x${game.puzzle.cols}:${game.puzzle.difficulty}`];
    b.textContent = best == null ? '' : `自己ベスト ${formatTime(best)}`;
  }
  if (b.childNodes.length) el.overlayCard.appendChild(b);
  el.overlayCard.appendChild(nextSettings());
  const row = document.createElement('div');
  row.className = 'row';
  const again = document.createElement('button');
  again.className = 'primary';
  again.textContent = 'つぎの問題';
  again.addEventListener('click', () => { hideOverlay(); newPuzzle(); });
  const look = document.createElement('button');
  look.textContent = '盤面を見る';
  look.addEventListener('click', () => {
    hideOverlay();
    say('盤面をタップすると、結果をもう一度出せます');
  });
  row.append(again, look);
  el.overlayCard.appendChild(row);
  el.overlay.hidden = false;
  again.focus();
}

/**
 * 完成のお知らせの中に置く「次の問題」の大きさ・むずかしさ。
 * メニューの選択と同じ値を持ち、変えたらメニューの側にも反映する。
 */
function nextSettings() {
  const box = document.createElement('div');
  box.className = 'next-settings';
  for (const [source, label] of [[el.size, '大きさ'], [el.difficulty, 'むずかしさ']]) {
    const field = document.createElement('label');
    field.className = 'field';
    const caption = document.createElement('span');
    caption.textContent = `次の${label}`;
    const select = document.createElement('select');
    for (const option of source.options) select.appendChild(option.cloneNode(true));
    select.value = source.value;
    select.addEventListener('change', () => {
      source.value = select.value;
      savePrefs();
      prefetchCurrent();
    });
    field.append(caption, select);
    box.appendChild(field);
  }
  return box;
}

function hideOverlay() {
  el.overlay.hidden = true;
}


function say(text, warn = false) {
  clearTimeout(messageTimer);
  el.message.textContent = text;
  el.message.classList.toggle('warn', warn);
  if (text) messageTimer = setTimeout(() => { el.message.textContent = ''; }, 6000);
}

/* ---------------- ヒントとチェック ---------------- */

// いま示せるヒントの列と、そのうち何番目を見せているか
let hints = [];
let hintIndex = 0;

/** ヒントのボタン：出ていなければ出し、出ていれば消す。 */
function toggleHint() {
  if (!el.hintPanel.hidden) {
    hideHint();
    board.clearHints();
    return;
  }
  showHint();
}

function showHint() {
  if (game.solved) return;
  game.hints = (game.hints ?? 0) + 1; // 解いた履歴に、ヒントを見た回数として残す
  hidePatterns();
  hints = findHints(game.grid, game.puzzle.clues, game.state, game.puzzle.solution);
  showHintAt(0);
}

/** ヒントの列の i 番目を見せる。ほかにもヒントがあれば ‹ › で切り替えられる。 */
function showHintAt(i) {
  if (!hints.length) return;
  hintIndex = Math.max(0, Math.min(hints.length - 1, i));
  const hint = hints[hintIndex];
  const many = hints.length > 1 && hint.type === 'move';
  el.hintNav.hidden = !many;
  el.hintPos.textContent = many ? `${hintIndex + 1} / ${hints.length}` : '';
  el.hintPrev.disabled = hintIndex === 0;
  el.hintNext.disabled = hintIndex === hints.length - 1;

  if (hint.type === 'none') {
    renderHint(hint, []);
    board.clearHints();
    return;
  }

  if (hint.type === 'mistake') {
    if (hint.edge != null) {
      board.setHints([hint.edge], hint.focus);
      board.cursor = hint.edge;
      board.showCursor = true;
      board._drawCursor();
    }
    renderHint(hint, hint.edge == null ? [] : [
      { label: 'ここを直す', primary: true, run: () => fixMistake(hint) },
    ]);
    return;
  }

  board.setHints([hint.edge], hint.focus, hint.value);
  board.ensureVisible(hint.edge);
  board.cursor = hint.edge;
  board.showCursor = true;
  board._drawCursor();
  renderHint(hint, [
    { label: `この${hint.value === LINE ? '線' : '×'}を置く`, primary: true, run: () => placeHint(hint) },
    { label: '自分で考える', run: () => { hideHint(); board.clearHints(); } },
  ]);
}

/** 横にはらう操作で前後へ送る（ボタンや文字の選択とぶつからないよう、はっきり横に動いたときだけ）。 */
function bindSwipe(target, onSwipe) {
  let start = null;
  target.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') return;
    start = { x: ev.clientX, y: ev.clientY };
  });
  target.addEventListener('pointerup', (ev) => {
    if (!start) return;
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
  });
  target.addEventListener('pointercancel', () => { start = null; });
}

// ヒントの文字はここまで小さくしてよい（これより小さいと読めない）
const HINT_MIN_SCALE = 0.7;
// 盤面は画面の高さのこの割合までなら縮めてよい（これより小さいと線を引きにくい）
const BOARD_MIN_SHARE = 0.3;

/** ヒント・定石の欄を開け閉めしたときや、画面の大きさが変わったときに、画面 1 枚に収め直す。 */
function fitScreen() {
  fitBoard();
  fitHint();
}

/**
 * 縦 1 列の画面で下の欄まで入りきらないときは、はみ出す分だけ盤面を小さくして、ページを送らずに済むようにする。
 * 盤面は縦横の比を保ったまま幅を絞って縮める（高さだけ絞ると、触った位置と線がずれる）。
 */
function fitBoard() {
  const svg = el.board;
  svg.style.maxWidth = '';
  if (getComputedStyle(svg.closest('.app')).display !== 'flex') return; // 横に並ぶ画面は別の決め方
  const hint = el.hintPanel;
  if (!hint.hidden) {
    // ヒントは文字を縮める前の大きさで場所を取る
    hint.classList.remove('is-overflow');
    hint.style.maxHeight = '';
    hint.style.setProperty('--hint-scale', '1');
  }
  const over = document.documentElement.scrollHeight - window.innerHeight;
  const rect = svg.getBoundingClientRect();
  if (over <= 0 || !rect.height) return;
  const height = Math.max(Math.min(rect.height, window.innerHeight * BOARD_MIN_SHARE), rect.height - over);
  svg.style.maxWidth = `${Math.floor(height * rect.width / rect.height)}px`;
}

/**
 * ヒントの欄を、スクロールせずに画面の下端までに収める。
 * 収まらなければ文字を少しずつ小さくし、それでも無理なら欄の中だけで送れるようにする。
 */
function fitHint() {
  const panel = el.hintPanel;
  if (panel.hidden) return;
  panel.classList.remove('is-overflow');
  panel.style.maxHeight = '';
  const available = window.innerHeight - panel.getBoundingClientRect().top - 12;
  let scale = 1;
  panel.style.setProperty('--hint-scale', String(scale));
  while (panel.offsetHeight > available && scale > HINT_MIN_SCALE) {
    scale = Math.max(HINT_MIN_SCALE, Math.round((scale - 0.05) * 100) / 100);
    panel.style.setProperty('--hint-scale', String(scale));
  }
  if (panel.offsetHeight > available && available > 120) {
    panel.style.maxHeight = `${available}px`;
    panel.classList.add('is-overflow');
  }
}

/** ヒントの内容をパネルに出す。 */
function renderHint(hint, actions) {
  const warn = hint.type === 'mistake';
  el.hintPanel.hidden = false;
  el.hint.classList.add('is-on');
  el.hint.setAttribute('aria-expanded', 'true');
  el.hintPanel.classList.toggle('is-warn', warn);
  el.hintBadge.replaceChildren(icon(warn ? 'warning' : 'lightbulb'));
  el.hintTitle.textContent = hint.title;
  el.hintText.textContent = hint.message;

  // 背理法のときは、矛盾までの手順を一手ずつ並べる
  const steps = hint.steps ?? [];
  el.hintSteps.textContent = '';
  for (const step of steps) {
    const li = document.createElement('li');
    li.className = `${step.kind} lv${Math.min(step.level, 2)}`;
    li.textContent = step.text;
    el.hintSteps.appendChild(li);
  }
  el.hintProof.hidden = steps.length === 0;
  // 手順は最初は必ず畳んでおく（見たいときだけ開く）
  el.hintProof.open = false;

  el.hintActions.textContent = '';
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    if (action.primary) button.className = 'primary';
    button.textContent = action.label;
    button.addEventListener('click', action.run);
    el.hintActions.appendChild(button);
  }
  say('');
  fitScreen();
}

function hideHint() {
  el.hintPanel.hidden = true;
  el.hintActions.textContent = '';
  el.hint.classList.remove('is-on');
  el.hint.setAttribute('aria-expanded', 'false');
  fitScreen();
}

/** ヒントが示した一手を実際に置く。 */
function placeHint(hint) {
  hideHint();
  board.clearHints();
  startTimer();
  applyChange(hint.edge, hint.value);
  if (hint.value === LINE && el.autocross.checked) {
    for (const e of autoCrossEdges(game.grid, game.puzzle.clues, game.state, [hint.edge])) {
      applyChange(e, CROSS);
    }
  }
  commitStroke();
  refreshAll();
}

/** 間違っている印を、正しい状態に戻す。 */
function fixMistake(hint) {
  hideHint();
  board.clearHints();
  applyChange(hint.edge, UNKNOWN);
  commitStroke();
  refreshAll();
  say('間違っていた印を消しました');
}

function check() {
  const a = analyze(game.grid, game.puzzle.clues, game.state);
  let wrong = 0;
  for (let e = 0; e < game.grid.edgeCount; e++) {
    if (game.state[e] !== UNKNOWN && game.state[e] !== game.puzzle.solution[e]) wrong++;
  }
  if (wrong > 0) {
    say(`正解と違う場所が ${wrong} か所あります`, true);
    return;
  }
  if (a.solved) { checkSolved(); return; }
  if (a.badCells.length || a.badVertices.length) {
    say('矛盾している場所があります', true);
    return;
  }
  say('ここまでは合っています。この調子！');
}

/* ---------------- タイマーと保存 ---------------- */

function startTimer() {
  if (game.running || game.solved) return;
  game.running = true;
  game.lastTick = Date.now();
}

function tickTimer() {
  const now = Date.now();
  if (game.running && !game.solved) {
    game.elapsed += Math.max(0, Math.round((now - game.lastTick) / 1000));
  }
  game.lastTick = now;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function persist() {
  if (!game.puzzle || game.solved) return;
  let edges = '';
  for (let i = 0; i < game.state.length; i++) edges += String(game.state[i]);
  store.saveGame({
    code: game.puzzle.code || encodePuzzle(game.puzzle),
    edges,
    elapsed: game.elapsed,
    hints: game.hints ?? 0,
    solution: Array.from(game.puzzle.solution),
  });
}

/**
 * いまの問題を URL（?p=問題コード）に出す。新しい問題になるたびに書き換えるので、
 * そのまま URL を送れば同じ問題を開ける。履歴は増やさない（戻るボタンで前の問題に戻ることはしない）。
 */
function showCodeInUrl(code) {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('p') === code) return;
    url.searchParams.set('p', code);
    history.replaceState(history.state, '', url);
  } catch {
    // file:// などで書き換えられなくても、遊ぶのには困らない
  }
}

async function copyCode() {
  const url = new URL(location.href);
  url.searchParams.set('p', el.code.value);
  const text = url.toString();
  try {
    await navigator.clipboard.writeText(text);
    say('共有リンクをコピーしました');
    // メニューの中では下のメッセージが見えないので、ボタンでも知らせる
    const label = el.copy.querySelector('span:last-child');
    label.textContent = 'コピーしました';
    setTimeout(() => { label.textContent = 'コピー'; }, 1600);
  } catch {
    el.code.select();
    say('コピーできませんでした。手動で選択してください', true);
  }
}

init();
