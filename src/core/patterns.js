/**
 * 定石（よく出る配置と、そこから確定すること）の一覧。
 *
 * ここに書いた「確定する」は思い込みではなく、tests/patterns.test.js が
 * 総当たり探索で毎回検証している。反例が 1 つでも見つかるパターンは
 * テストが落ちるので、ヘルプページに嘘が載らない。
 *
 * 座標の書き方:
 *   clues:    [行, 列, 数字]
 *   given:    ['h' | 'v', 行, 列, 'line' | 'cross']   最初から分かっている印
 *   conclude: given と同じ形式。ここが「確定する」場所。
 *   辺の番号は grid.js と同じで、h(r,c) はマス (r,c) の上辺、v(r,c) は左辺。
 */

import { getGrid, LINE, CROSS } from './grid.js';

export const CATEGORIES = [
  { id: 'basic', title: 'まず覚える', lead: 'この 3 つが分かれば、あとは組み合わせです。' },
  { id: 'corner', title: '盤の角と縁', lead: '外周には線を引けない方向があるので、角では数字が強く効きます。' },
  { id: 'numbers', title: '数字どうしの関係', lead: '隣り合ったり斜めに並んだ数字は、それだけで形が決まります。' },
  { id: 'incoming', title: '線が来たとき', lead: '引いた線の先で何が決まるか。ここが解き進めるエンジンです。' },
  { id: 'loop', title: '輪をつくるルール', lead: '「ひとつの輪」という条件そのものが手がかりになります。' },
];

export const PATTERNS = [
  // ---------------- まず覚える ----------------
  {
    id: 'zero',
    category: 'basic',
    title: '0 のまわりは全部 ×',
    rows: 3, cols: 3, interior: true,
    clues: [[1, 1, 0]],
    given: [],
    conclude: [
      ['h', 1, 1, 'cross'], ['h', 2, 1, 'cross'],
      ['v', 1, 1, 'cross'], ['v', 1, 2, 'cross'],
    ],
    why: '0 は「まわりの 4 辺に 1 本も線が通らない」という意味です。迷う余地がないので、盤面を開いたら真っ先に × で埋めてしまいましょう。',
  },
  {
    id: 'vertex-two',
    category: 'basic',
    title: '交点に線が 2 本集まったら、残りは ×',
    rows: 2, cols: 2, interior: true,
    clues: [],
    given: [['h', 1, 0, 'line'], ['v', 0, 1, 'line']],
    conclude: [['h', 1, 1, 'cross'], ['v', 1, 1, 'cross']],
    why: '輪は一本道なので、どの交点でも線は「通り過ぎる」だけ。集まる線はちょうど 2 本までです。3 本目があると分かれ道ができてしまいます。',
  },
  {
    id: 'dead-end',
    category: 'basic',
    title: '線の端は、必ずもう 1 本つながる',
    rows: 2, cols: 2, interior: true,
    clues: [],
    given: [['h', 1, 0, 'line'], ['v', 0, 1, 'cross'], ['h', 1, 1, 'cross']],
    conclude: [['v', 1, 1, 'line']],
    why: '線の先が行き止まりになると輪が閉じません。端の交点で残る道が 1 本しかないなら、そこは線で確定です。',
  },

  // ---------------- 盤の角と縁 ----------------
  {
    id: 'corner-three',
    category: 'corner',
    title: '角の 3',
    rows: 2, cols: 2, interior: false,
    clues: [[0, 0, 3]],
    given: [],
    conclude: [['h', 0, 0, 'line'], ['v', 0, 0, 'line']],
    why: '外側の 2 辺のどちらかを × にすると、角の点に線が 1 本だけ入る形になり、行き止まりができてしまいます。だから外側の 2 辺は両方とも線です。',
  },
  {
    id: 'corner-one',
    category: 'corner',
    title: '角の 1',
    rows: 2, cols: 2, interior: false,
    clues: [[0, 0, 1]],
    given: [],
    conclude: [['h', 0, 0, 'cross'], ['v', 0, 0, 'cross']],
    why: '外側の 2 辺のどちらかが線だと、角の点から線が 1 本だけ出て行き止まりになります。2 本とも線にすると今度は数字の 1 を超えてしまいます。よって外側は両方 × です。',
  },
  {
    id: 'corner-two',
    category: 'corner',
    title: '角の 2',
    rows: 3, cols: 3, interior: false,
    clues: [[0, 0, 2]],
    given: [],
    conclude: [['h', 0, 1, 'line'], ['v', 1, 0, 'line']],
    why: '角の点に集まる線は 0 本か 2 本なので、外側の 2 辺は「両方とも線」か「両方とも ×」のどちらかです。どちらの場合も、マスから外へ出ていく線が上下・左右に 1 本ずつ必要になり、結果として外周を 1 マス分ずらした 2 辺が線で確定します。角の 2 自体の 4 辺は、この段階ではまだ決まりません。',
  },

  // ---------------- 数字どうしの関係 ----------------
  {
    id: 'three-three',
    category: 'numbers',
    title: '3 と 3 がとなり合う',
    rows: 3, cols: 4, interior: true,
    clues: [[1, 1, 3], [1, 2, 3]],
    given: [],
    conclude: [
      ['v', 1, 1, 'line'], ['v', 1, 3, 'line'],
      ['v', 0, 2, 'cross'], ['v', 2, 2, 'cross'],
    ],
    why: '外側の縦 2 辺が線、そして 2 つのマスの境目から上下へ伸びる辺が × になります。境目の辺を線にすると、その両端の交点で線が 3 本集まってしまうからです。',
    caution: 'よく「まん中の境目も線になる」と説明されますが、これは正しくありません。2 マスをまとめて囲む長方形の輪でも 3 と 3 は成立します（このときまん中は ×）。まん中の辺は、まわりの状況が決まるまで保留です。',
  },
  {
    id: 'three-three-diagonal',
    category: 'numbers',
    title: '3 と 3 が斜めに並ぶ',
    rows: 4, cols: 4, interior: true,
    clues: [[1, 1, 3], [2, 2, 3]],
    given: [],
    conclude: [
      ['h', 1, 1, 'line'], ['v', 1, 1, 'line'],
      ['h', 3, 2, 'line'], ['v', 2, 3, 'line'],
    ],
    why: '2 つの 3 が接する角から見て、それぞれ「外側」にあたる 2 辺が線になります。内側を削ると必ずどちらかの 3 が足りなくなるためです。3 が斜めに続くときは、同じ形がそのまま連鎖します。',
  },
  {
    id: 'zero-three',
    category: 'numbers',
    title: '0 のとなりの 3',
    rows: 3, cols: 4, interior: true,
    clues: [[1, 1, 0], [1, 2, 3]],
    given: [],
    conclude: [
      ['h', 1, 2, 'line'], ['h', 2, 2, 'line'], ['v', 1, 3, 'line'],
      ['v', 1, 2, 'cross'], ['h', 1, 1, 'cross'], ['h', 2, 1, 'cross'], ['v', 1, 1, 'cross'],
    ],
    why: '0 のまわりは全部 × なので、2 つのマスが共有する辺も × です。3 は残った 3 辺をすべて使うしかありません。',
  },
  {
    id: 'zero-three-diagonal',
    category: 'numbers',
    title: '0 と 3 が斜めに並ぶ',
    rows: 4, cols: 4, interior: true,
    clues: [[1, 1, 0], [2, 2, 3]],
    given: [],
    conclude: [
      ['h', 2, 2, 'line'], ['v', 2, 2, 'line'],
      ['h', 1, 1, 'cross'], ['h', 2, 1, 'cross'], ['v', 1, 1, 'cross'], ['v', 1, 2, 'cross'],
    ],
    why: '0 のまわりが全部 × になると、2 つのマスが接する角の点には 0 側から線が来られません。3 のその角にある 2 辺は、片方だけ線にすると行き止まりになるので、両方とも線になります。',
  },

  // ---------------- 線が来たとき ----------------
  {
    id: 'line-into-three',
    category: 'incoming',
    title: '3 の角に線が入ってきた',
    rows: 3, cols: 3, interior: true,
    clues: [[1, 1, 3]],
    given: [['h', 1, 0, 'line']],
    conclude: [['h', 2, 1, 'line'], ['v', 1, 2, 'line']],
    why: '入ってきた線はその角で必ず曲がるので、3 の 4 辺のうちその角に接する 2 辺は、どちらか一方だけが線になります。3 は 3 本必要なので、残る「遠い側」の 2 辺は両方とも線です。',
  },
  {
    id: 'line-into-one',
    category: 'incoming',
    title: '1 の角に線が入ってきた',
    rows: 3, cols: 3, interior: true,
    clues: [[1, 1, 1]],
    given: [['h', 1, 0, 'line'], ['v', 0, 1, 'cross']],
    conclude: [['h', 2, 1, 'cross'], ['v', 1, 2, 'cross']],
    why: '入ってきた線の行き先が 1 のマスの 2 辺しか残っていないので、1 が使える 1 本はその角で消費されます。遠い側の 2 辺は × で確定です。',
  },
  {
    id: 'three-one-cross',
    category: 'incoming',
    title: '3 の 1 辺が × と分かったら',
    rows: 3, cols: 3, interior: true,
    clues: [[1, 1, 3]],
    given: [['h', 1, 1, 'cross']],
    conclude: [
      ['h', 2, 1, 'line'], ['v', 1, 1, 'line'], ['v', 1, 2, 'line'],
      ['h', 2, 0, 'cross'], ['h', 2, 2, 'cross'], ['v', 2, 1, 'cross'], ['v', 2, 2, 'cross'],
    ],
    why: '3 は 4 辺のうち 1 辺だけが × なので、× が 1 つ見つかった時点で残り 3 辺は線で確定します。さらに、線が集まった下の 2 つの交点はもう 2 本ずつ使っているので、そこから外へ伸びる辺はすべて × になります。1 つの発見が一気に 7 本に広がる、いちばん気持ちのいい形です。',
  },
  {
    id: 'two-corner-crosses',
    category: 'incoming',
    title: '2 の角が × 2 つでふさがれた',
    rows: 3, cols: 3, interior: true,
    clues: [[1, 1, 2]],
    given: [['h', 1, 1, 'cross'], ['v', 1, 1, 'cross']],
    conclude: [['h', 2, 1, 'line'], ['v', 1, 2, 'line']],
    why: '2 本必要なのに 2 辺がふさがれたので、残った 2 辺を使うしかありません。数字のまわりで × が増えてきたら、いつもこの形を探します。',
  },

  // ---------------- 輪をつくるルール ----------------
  {
    id: 'no-small-loop',
    category: 'loop',
    title: '小さな輪を閉じてはいけない',
    rows: 4, cols: 4, interior: false,
    clues: [[3, 3, 1]],
    given: [
      ['h', 1, 1, 'line'], ['v', 1, 1, 'line'], ['v', 1, 2, 'line'],
    ],
    conclude: [['h', 2, 1, 'cross']],
    why: 'あと 1 辺で小さな輪が閉じる形ですが、右下の 1 は「このマスのまわりに線が 1 本ある」と言っているので、盤面の別の場所にも必ず線が必要です。ここで閉じてしまうと輪が 2 つになってしまうため、この辺は × で確定します。答えはいつも「ひとつながりの輪ひとつだけ」です。',
  },
];

/** 定義から盤面を組み立てる。 */
export function buildPattern(pattern) {
  const grid = getGrid(pattern.rows, pattern.cols);
  const clues = new Int8Array(grid.cellCount).fill(-1);
  for (const [r, c, n] of pattern.clues) clues[r * pattern.cols + c] = n;

  const given = new Int8Array(grid.edgeCount);
  for (const mark of pattern.given) given[edgeIndex(grid, mark)] = markValue(mark);

  const conclude = pattern.conclude.map((mark) => ({
    edge: edgeIndex(grid, mark),
    value: markValue(mark),
  }));

  return { grid, clues, given, conclude };
}

export function edgeIndex(grid, [dir, r, c]) {
  return dir === 'h' ? grid.h(r, c) : grid.v(r, c);
}

export function markValue([, , , kind]) {
  return kind === 'line' ? LINE : CROSS;
}

/**
 * 内側の定石を、まわりに余白のある大きな盤へ移す。
 * 盤の端の影響で「たまたま」確定していないかを確かめるために使う。
 */
export function padded(pattern, pad = 2) {
  const shift = ([dir, r, c, kind]) => [dir, r + pad, c + pad, kind];
  return {
    ...pattern,
    rows: pattern.rows + pad * 2,
    cols: pattern.cols + pad * 2,
    clues: pattern.clues.map(([r, c, n]) => [r + pad, c + pad, n]),
    given: pattern.given.map(shift),
    conclude: pattern.conclude.map(shift),
  };
}
