import { getGrid, UNKNOWN, LINE, CROSS } from '../core/grid.js';
import { analyze, autoCrossEdges, findHints } from '../core/game.js';
import { decodePuzzle, encodePuzzle, solutionFor } from '../core/puzzle.js';
import { DIFFICULTIES } from '../core/generator.js';
import { Board } from './board.js';
import { renderPatternsInto } from './patterns-view.js';
import { findMatches } from '../core/pattern-match.js';
import { PATTERNS } from '../core/patterns.js';
import { PuzzleService } from './puzzle-service.js';
import { PatternCards } from './pattern-cards.js';
import { store } from './storage.js';

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
  board: $('board'),
  size: $('sel-size'),
  difficulty: $('sel-difficulty'),
  newBtn: $('btn-new'),
  undo: $('btn-undo'),
  redo: $('btn-redo'),
  hint: $('btn-hint'),
  check: $('btn-check'),
  clear: $('btn-clear'),
  time: $('status-time'),
  progress: $('status-progress'),
  best: $('status-best'),
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
  puzzleInfo: $('status-puzzle'),
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
  });
  cards = new PatternCards({
    track: el.patTrack,
    position: el.patPos,
    prev: el.patPrev,
    next: el.patNext,
    onApply: (item) => applyPattern(item.pattern),
    onFocus: focusPatternCard,
    emptyActions: [
      { label: 'ヒントを見る', run: () => showHint() },
      { label: '定石の一覧', run: () => openDrawer() },
    ],
  });
  board.showErrors = el.errors.checked;
  board.fadeDone = el.fade.checked;
  setInputMode(prefs.inputMode === 'cross' ? 'cross' : 'line');

  bindUI();
  if (wantDrawerOpen) openDrawer({ instant: true });

  const fromUrl = new URLSearchParams(location.search).get('p');
  if (fromUrl && tryLoadCode(fromUrl, true)) return;
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
  el.hint.addEventListener('click', showHint);
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
  // 盤面のほうを触りたいだけのときもあるので、開いたままでも遊べるようにしておく
  el.rulesPatternsBtn.addEventListener('click', () => {
    el.rulesModal.hidden = true;
    openDrawer();
  });
  // ✕ は「自分で考える」と同じ。説明を閉じて、盤面の光りも消す
  el.hintClose.addEventListener('click', () => { hideHint(); board.clearHints(); });
  el.hintPrev.addEventListener('click', () => showHintAt(hintIndex - 1));
  el.hintNext.addEventListener('click', () => showHintAt(hintIndex + 1));
  bindSwipe(el.hintPanel, (dir) => showHintAt(hintIndex + dir));
  el.drawerClose.addEventListener('click', () => closeDrawer());
  el.drawerScrim.addEventListener('click', () => closeDrawer());

  el.rulesBtn.addEventListener('click', () => { el.rulesModal.hidden = false; });
  el.menuBtn.addEventListener('click', openMenu);
  el.closeMenu.addEventListener('click', closeMenu);
  el.menuModal.addEventListener('click', (ev) => {
    if (ev.target === el.menuModal) closeMenu();
  });
  el.closeRules.addEventListener('click', () => { el.rulesModal.hidden = true; });
  el.rulesModal.addEventListener('click', (ev) => {
    if (ev.target === el.rulesModal) el.rulesModal.hidden = true;
  });
  el.theme.addEventListener('click', toggleTheme);

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      // 手前に重なっているものから閉じる
      if (isDrawerOpen()) { closeDrawer(); return; }
      if (!el.hintPanel.hidden) { hideHint(); board.clearHints(); return; }
      if (isPatternsOpen()) { hidePatterns(); return; }
      if (!el.menuModal.hidden) { closeMenu(); return; }
      el.rulesModal.hidden = true;
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
      showHint();
    } else if (!mod && !isTyping(ev.target) && (ev.key === 'p' || ev.key === 'P')) {
      ev.preventDefault();
      if (isPatternsOpen()) hidePatterns(); else showPatterns();
    } else if (!mod && !isTyping(ev.target) && (ev.key === 'm' || ev.key === 'M')) {
      ev.preventDefault();
      setInputMode(board.inputMode === 'cross' ? 'line' : 'cross');
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

function openMenu() {
  el.menuModal.hidden = false;
  el.closeMenu.focus();
}

function closeMenu() {
  if (el.menuModal.hidden) return;
  el.menuModal.hidden = true;
  el.menuBtn.focus();
}

/** 「7 × 7 ・ ふつう」のように、いま解いている問題の大きさとむずかしさを出す。 */
function updatePuzzleInfo() {
  const p = game.puzzle;
  if (!p) return;
  el.puzzleInfo.textContent = `${p.rows} × ${p.cols} ・ ${DIFFICULTIES[p.difficulty]?.label ?? ''}`;
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
}

function hidePatterns() {
  if (el.patPanel.hidden) return;
  el.patPanel.hidden = true;
  el.quickPatterns.setAttribute('aria-expanded', 'false');
  el.quickPatterns.classList.remove('is-on');
  board.clearHints();
}

/** 盤面が変わったら数え直す。見ていたカードがまだ使えるなら、そのカードのまま。 */
function refreshPatternCards(keep) {
  const items = usablePatterns();
  el.patPanel.querySelector('h2').textContent = items.length
    ? `いま使える定石 ${items.length} 個`
    : 'いま使える定石';
  cards.render(items, keep === undefined ? cards.focusedId : keep);
}

/** 見ているカードの定石が、盤面のどこで何を決めるかを光らせる。 */
function focusPatternCard(item) {
  if (!item) { board.clearHints(); return; }
  board.setHints(item.fills.map((f) => f.edge), null, new Map(item.fills.map((f) => [f.edge, f.value])));
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
function isTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}

/** タップしたときの印の付き方を切り替える。 */
function setInputMode(mode) {
  const next = mode === 'cross' ? 'cross' : 'line';
  board.inputMode = next;
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
  const waiting = setTimeout(() => say('問題を作っています…'), 180);
  try {
    const puzzle = await service.get(rows, cols, difficulty);
    clearTimeout(waiting);
    startPuzzle(puzzle);
    say('');
  } catch (err) {
    clearTimeout(waiting);
    say(err.message || '問題を作れませんでした', true);
  } finally {
    game.busy = false;
    el.newBtn.disabled = false;
  }
}

function startPuzzle(puzzle, saved) {
  hideHint();
  hidePatterns();
  game.puzzle = puzzle;
  game.grid = getGrid(puzzle.rows, puzzle.cols);
  game.state = saved?.state ?? new Int8Array(game.grid.edgeCount);
  game.undoStack = [];
  game.redoStack = [];
  game.pending = [];
  game.elapsed = saved?.elapsed ?? 0;
  game.solved = false;
  game.running = false;
  game.lastTick = Date.now();

  if (!saved) applyZeroCrosses();
  board.setPuzzle(puzzle, game.state);
  board.setSolved(false);
  hideOverlay();
  el.code.value = puzzle.code || encodePuzzle(puzzle);
  updateBest();
  updatePuzzleInfo();
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
      code: saved.code,
      clueCount: countClues(decoded.clues),
    }, { state, elapsed: saved.elapsed || 0 });
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
    say(fromUrl ? '' : '問題を読み込みました');
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
  el.progress.textContent = `数字 ${a.satisfied} / ${a.total}`;
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
  updateBest();
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
  if (isBest) {
    const b = document.createElement('p');
    b.className = 'best';
    b.append(icon('emoji_events'), '自己ベスト更新！');
    el.overlayCard.appendChild(b);
  }
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

function updateBest() {
  const key = `${game.puzzle.rows}x${game.puzzle.cols}:${game.puzzle.difficulty}`;
  const best = store.records()[key];
  el.best.textContent = best == null ? '自己ベスト —' : `自己ベスト ${formatTime(best)}`;
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

function showHint() {
  if (game.solved) return;
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

/** ヒントの内容をパネルに出す。 */
function renderHint(hint, actions) {
  const warn = hint.type === 'mistake';
  el.hintPanel.hidden = false;
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
  el.hintProof.open = steps.length > 0 && steps.length <= 6;

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
}

function hideHint() {
  el.hintPanel.hidden = true;
  el.hintActions.textContent = '';
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
  el.time.textContent = formatTime(game.elapsed);
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
    solution: Array.from(game.puzzle.solution),
  });
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
