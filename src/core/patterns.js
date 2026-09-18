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
 *
 * anchor は、この形を盤面のどこに当てはめてよいかを表す。
 *   'interior' 盤上のどこでも（回転・反転あわせて 8 方向を試す）
 *   'corner'   盤の角にぴったり合わせたときだけ
 *   'border'   盤の縁にぴったり付けて、縁に沿ってずらしたときだけ
 *   'none'     型として当てはめるものではない（match で別扱いにする）
 * match は当てはめ方。既定は型の照合。'vertex' は「交点の線は 0 本か 2 本」、
 * 'loop' は「輪はひとつだけ」、'bridge' は「戻ってこられない辺は通れない」を
 * 盤面全体に適用する特別扱い（型ではなくルールそのものを当てはめる）。
 *
 * smallLoop と loopConclude は「輪はひとつだけ」に頼る結論のための組で、
 * smallLoop の輪が盤面の数字をすべて満たしてしまう（＝答えになりうる）ときは
 * loopConclude を使わない。
 */

import { getGrid, LINE, CROSS } from './grid.js';

export const CATEGORIES = [
  { id: 'basic', title: 'まず覚える', lead: 'この 5 つが分かれば、あとは組み合わせです。' },
  { id: 'corner', title: '盤の角と縁', lead: '外周には線を引けない方向があるので、角や縁では数字が強く効きます。' },
  { id: 'numbers', title: '数字どうしの関係', lead: '隣り合ったり斜めに並んだ数字は、それだけで形が決まります。' },
  { id: 'incoming', title: '線や × が来たとき', lead: '引いた印の先で何が決まるか。ここが解き進めるエンジンです。' },
  { id: 'loop', title: '輪をつくるルール', lead: '「ひとつの輪」という条件そのものが手がかりになります。' },
];

// level は目安のやさしさ。1 がいちばん易しく、5 がいちばん難しい。
// 一覧はこの順（分類ごと、その中は level 順）に並べる。
export const PATTERNS = [
  // ---------------- まず覚える ----------------
  {
    id: 'vertex-rule',
    category: 'basic', level: 1, match: 'vertex',
    title: '交点に集まる線は 0 本か 2 本',
    rows: 2, cols: 2, anchor: 'none',
    clues: [],
    given: [['h', 1, 0, 'line'], ['v', 0, 1, 'cross'], ['v', 1, 1, 'cross']],
    conclude: [['h', 1, 1, 'line']],
    why: '輪は枝分かれも交差も行き止まりもしません。だから交点に集まる線は 0 本か 2 本だけ。2 本そろったら残りは ×、線の端で行き先が 1 つしかなければそこは線、線が無くて残り 1 本になったらそこも × です。この定石は盤面じゅうの交点にこれをまとめて当てはめます（下の 3 つでは拾えない、まっすぐ進む形や盤の角・縁の点も含みます）。',
  },
  {
    id: 'zero',
    category: 'basic', level: 1,
    title: '0 のまわりは全部 ×',
    rows: 3, cols: 3, anchor: 'interior',
    clues: [[1, 1, 0]],
    given: [],
    conclude: [
      ['h', 1, 1, 'cross'], ['h', 2, 1, 'cross'],
      ['v', 1, 1, 'cross'], ['v', 1, 2, 'cross'],
    ],
    why: '0 は「まわりの 4 辺に 1 本も線が通らない」という意味です。迷う余地がないので、盤面を開いたら真っ先に × で埋めてしまいましょう。',
  },
  {
    id: 'clue-full',
    category: 'basic', level: 1,
    title: '数字の本数がそろったら、残りは ×',
    rows: 3, cols: 3, anchor: 'interior',
    clues: [[1, 1, 1]],
    given: [['h', 1, 1, 'line']],
    conclude: [['h', 2, 1, 'cross'], ['v', 1, 1, 'cross'], ['v', 1, 2, 'cross']],
    why: '数字はそのマスの線の本数をぴったり表します。1 に線が 1 本引けたら、残り 3 辺はもう線を引けません。当たり前ですが、× を書き込んでおくと次の手がぐっと見えやすくなります。',
  },
  {
    id: 'vertex-two',
    category: 'basic', level: 1,
    title: '交点に線が 2 本集まったら、残りは ×',
    rows: 2, cols: 2, anchor: 'interior',
    clues: [],
    given: [['h', 1, 0, 'line'], ['v', 0, 1, 'line']],
    conclude: [['h', 1, 1, 'cross'], ['v', 1, 1, 'cross']],
    why: '輪は一本道なので、どの交点でも線は「通り過ぎる」だけ。集まる線はちょうど 2 本までです。3 本目があると分かれ道ができてしまいます。',
  },
  {
    id: 'vertex-three-crosses',
    category: 'basic', level: 2,
    title: '交点の 3 方向が × なら、残りも ×',
    rows: 2, cols: 2, anchor: 'interior',
    clues: [],
    given: [['h', 1, 0, 'cross'], ['v', 0, 1, 'cross'], ['v', 1, 1, 'cross']],
    conclude: [['h', 1, 1, 'cross']],
    why: 'ここに線を引くと、その交点から線が 1 本だけ出る行き止まりになってしまいます。交点の線は 0 本か 2 本なので、逃げ道が 1 つも残っていないなら、そこも × です。× をこまめに書き込むほど、この形が見つかります。',
  },
  {
    id: 'dead-end',
    category: 'basic', level: 2,
    title: '線の端は、必ずもう 1 本つながる',
    rows: 2, cols: 2, anchor: 'interior',
    clues: [],
    given: [['h', 1, 0, 'line'], ['v', 0, 1, 'cross'], ['h', 1, 1, 'cross']],
    conclude: [['v', 1, 1, 'line']],
    why: '線の先が行き止まりになると輪が閉じません。端の交点で残る道が 1 本しかないなら、そこは線で確定です。',
  },
  {
    id: 'three-one-cross',
    category: 'basic', level: 2,
    title: '3 の 1 辺が × と分かったら',
    rows: 3, cols: 3, anchor: 'interior',
    clues: [[1, 1, 3]],
    given: [['h', 1, 1, 'cross']],
    conclude: [
      ['h', 2, 1, 'line'], ['v', 1, 1, 'line'], ['v', 1, 2, 'line'],
      ['h', 2, 0, 'cross'], ['h', 2, 2, 'cross'], ['v', 2, 1, 'cross'], ['v', 2, 2, 'cross'],
    ],
    why: '3 は 4 辺のうち 1 辺だけが × なので、× が 1 つ見つかった時点で残り 3 辺は線で確定します。さらに、線が集まった下の 2 つの交点はもう 2 本ずつ使っているので、そこから外へ伸びる辺はすべて × になります。1 つの発見が一気に 7 本に広がる、いちばん気持ちのいい形です。',
  },

  // ---------------- 盤の角と縁 ----------------
  {
    id: 'corner-one',
    category: 'corner', level: 1,
    title: '角の 1',
    rows: 2, cols: 2, anchor: 'corner',
    clues: [[0, 0, 1]],
    given: [],
    conclude: [['h', 0, 0, 'cross'], ['v', 0, 0, 'cross']],
    why: '外側の 2 辺のどちらかが線だと、角の点から線が 1 本だけ出て行き止まりになります。2 本とも線にすると今度は数字の 1 を超えてしまいます。よって外側は両方 × です。',
  },
  {
    id: 'corner-three',
    category: 'corner', level: 1,
    title: '角の 3',
    rows: 2, cols: 2, anchor: 'corner',
    clues: [[0, 0, 3]],
    given: [],
    conclude: [['h', 0, 0, 'line'], ['v', 0, 0, 'line']],
    why: '外側の 2 辺のどちらかを × にすると、角の点に線が 1 本だけ入る形になり、行き止まりができてしまいます。だから外側の 2 辺は両方とも線です。',
  },
  {
    id: 'border-zero',
    category: 'corner', level: 2,
    title: '縁の 0',
    rows: 2, cols: 3, anchor: 'border',
    clues: [[0, 1, 0]],
    given: [],
    conclude: [
      ['h', 0, 1, 'cross'], ['h', 1, 1, 'cross'], ['v', 0, 1, 'cross'], ['v', 0, 2, 'cross'],
      ['h', 0, 0, 'cross'], ['h', 0, 2, 'cross'],
    ],
    why: '外周にある 0 は、自分の 4 辺だけでなく、盤の縁にそって左右に伸びる辺も × にします。縁の点には内側へ向かう道が 1 本しかないので、そこが × なら縁沿いの線も行き止まりになってしまうからです。',
  },
  {
    id: 'border-vertex-crosses',
    category: 'corner', level: 2,
    title: '縁の交点は、2 方向が × なら残りも ×',
    rows: 2, cols: 4, anchor: 'border',
    clues: [],
    given: [['h', 0, 1, 'cross'], ['v', 0, 2, 'cross']],
    conclude: [['h', 0, 2, 'cross']],
    why: '外周の点から出られる方向は 3 つしかありません。そのうち 2 つが × なら、残る 1 つに線を引くと行き止まりになるので、そこも × です。盤の縁では 1 つ少ない数で決まるのがポイントです。',
  },
  {
    id: 'border-one-one',
    category: 'corner', level: 2,
    title: '縁に 1 が 2 つ並ぶ',
    rows: 2, cols: 4, anchor: 'border',
    clues: [[0, 1, 1], [0, 2, 1]],
    given: [],
    conclude: [['v', 0, 2, 'cross']],
    why: '2 つの 1 が共有する辺に線を引くと、その線の両端はどちらも外周の点です。外周の点から先へ進むには、どちらかの 1 がもう 1 本を使うことになり、1 本しか引けない 1 には多すぎます。だから境目は × です。',
  },
  {
    id: 'border-one-three',
    category: 'corner', level: 3,
    title: '縁に 1 と 3 が並ぶ',
    rows: 2, cols: 4, anchor: 'border',
    clues: [[0, 1, 1], [0, 2, 3]],
    given: [],
    conclude: [['h', 0, 2, 'line'], ['h', 1, 1, 'cross'], ['v', 0, 1, 'cross']],
    why: '3 の側は外周にそった辺が線で確定し、1 の側は内側と外向きの 2 辺が × になります。1 が使える 1 本は、2 つのマスの境目に取っておく必要があるからです。',
  },
  {
    id: 'corner-two',
    category: 'corner', level: 3,
    title: '角の 2',
    rows: 3, cols: 3, anchor: 'corner',
    clues: [[0, 0, 2]],
    given: [],
    conclude: [['h', 0, 1, 'line'], ['v', 1, 0, 'line']],
    why: '角の点に集まる線は 0 本か 2 本なので、外側の 2 辺は「両方とも線」か「両方とも ×」のどちらかです。どちらの場合も、マスから外へ出ていく線が上下・左右に 1 本ずつ必要になり、結果として外周を 1 マス分ずらした 2 辺が線で確定します。角の 2 自体の 4 辺は、この段階ではまだ決まりません。',
  },

  {
    id: 'corner-one-one',
    category: 'corner', level: 3,
    title: '角の 1 のとなりに 1',
    rows: 2, cols: 2, anchor: 'corner',
    clues: [[0, 0, 1], [0, 1, 1]],
    given: [],
    conclude: [
      ['h', 0, 0, 'cross'], ['h', 0, 1, 'cross'], ['h', 1, 0, 'line'],
      ['v', 0, 0, 'cross'], ['v', 0, 1, 'cross'], ['v', 1, 0, 'line'],
    ],
    why: '角の 1 で外側 2 辺が × になり、そこから縁の考え方が連鎖します。結果として 2 つの 1 は内側でそれぞれ 1 本ずつを使い、角のマスの内側 2 辺が線で確定します。',
  },
  {
    id: 'corner-one-three',
    category: 'corner', level: 3,
    title: '角の 1 のとなりに 3',
    rows: 2, cols: 2, anchor: 'corner',
    clues: [[0, 0, 1], [0, 1, 3]],
    given: [],
    conclude: [
      ['h', 0, 0, 'cross'], ['h', 1, 0, 'cross'], ['v', 0, 0, 'cross'],
      ['h', 0, 1, 'line'], ['v', 0, 1, 'line'], ['v', 1, 0, 'cross'],
    ],
    why: '角の 1 は外側 2 辺が × です。すると角のマスにはもう線を引ける場所がほとんど残らず、1 本ぶんは 3 との境目で使われます。3 の側は外周にそった辺が線になります。',
  },
  {
    id: 'corner-two-one',
    category: 'corner', level: 4,
    title: '角の 2 のとなりに 1',
    rows: 2, cols: 3, anchor: 'corner',
    clues: [[0, 0, 2], [0, 1, 1]],
    given: [],
    conclude: [
      ['h', 0, 0, 'line'], ['h', 0, 1, 'line'], ['h', 0, 2, 'line'],
      ['v', 0, 0, 'line'], ['v', 1, 0, 'line'],
      ['h', 1, 0, 'cross'], ['h', 1, 1, 'cross'],
      ['v', 0, 1, 'cross'], ['v', 0, 2, 'cross'], ['v', 1, 1, 'cross'],
    ],
    why: '角の 2 は「外側 2 辺が両方線」か「両方 ×」のどちらかですが、となりが 1 だと後者では線が足りなくなります。外側を通る形に決まり、そこから一気に 10 本が確定します。',
  },
  {
    id: 'corner-two-three',
    category: 'corner', level: 4,
    title: '角の 2 のとなりに 3',
    rows: 2, cols: 3, anchor: 'corner',
    clues: [[0, 0, 2], [0, 1, 3]],
    given: [],
    conclude: [
      ['h', 0, 1, 'line'], ['v', 0, 2, 'line'], ['v', 1, 0, 'line'],
      ['h', 0, 2, 'cross'],
    ],
    why: '角の 2 で確定する外周の線に、3 の側の形が重なります。3 は角とは反対がわに直角を作る形になり、線がもう 1 本増えます。',
  },

  // ---------------- 数字どうしの関係 ----------------
  {
    id: 'zero-three',
    category: 'numbers', level: 2,
    title: '0 のとなりの 3',
    rows: 3, cols: 4, anchor: 'interior',
    clues: [[1, 1, 0], [1, 2, 3]],
    given: [],
    conclude: [
      ['h', 1, 1, 'cross'], ['h', 2, 1, 'cross'], ['v', 1, 1, 'cross'], ['v', 1, 2, 'cross'],
      ['h', 1, 2, 'line'], ['h', 2, 2, 'line'], ['v', 1, 3, 'line'],
      ['v', 0, 2, 'line'], ['v', 2, 2, 'line'],
      ['h', 1, 3, 'cross'], ['h', 2, 3, 'cross'], ['v', 0, 3, 'cross'], ['v', 2, 3, 'cross'],
    ],
    why: '0 のまわりは全部 × なので、2 つのマスが共有する辺も × です。3 は残った 3 辺をすべて使うしかありません。さらに線の端が上下に 1 本ずつ伸び、右側の 2 つの交点はもう 2 本ずつ使ってしまうので、その先はすべて × になります。一度に 13 本が決まる強力な形です。',
  },
  {
    id: 'zero-one-diagonal',
    category: 'numbers', level: 2,
    title: '0 の斜めの 1',
    rows: 4, cols: 4, anchor: 'interior',
    clues: [[1, 1, 0], [2, 2, 1]],
    given: [],
    conclude: [
      ['h', 1, 1, 'cross'], ['h', 2, 1, 'cross'], ['v', 1, 1, 'cross'], ['v', 1, 2, 'cross'],
      ['h', 2, 2, 'cross'], ['v', 2, 2, 'cross'],
    ],
    why: '0 のまわりが全部 × になると、2 つのマスが接する角の点には 0 側から線が来られません。そこを線が通るなら 1 のその角の 2 辺を両方使うことになり、1 本しか引けない 1 には多すぎます。だから 1 のその角の 2 辺は × です。',
  },
  {
    id: 'zero-three-diagonal',
    category: 'numbers', level: 2,
    title: '0 と 3 が斜めに並ぶ',
    rows: 4, cols: 4, anchor: 'interior',
    clues: [[1, 1, 0], [2, 2, 3]],
    given: [],
    conclude: [
      ['h', 2, 2, 'line'], ['v', 2, 2, 'line'],
      ['h', 1, 1, 'cross'], ['h', 2, 1, 'cross'], ['v', 1, 1, 'cross'], ['v', 1, 2, 'cross'],
    ],
    why: '0 のまわりが全部 × になると、2 つのマスが接する角の点には 0 側から線が来られません。3 のその角にある 2 辺は、片方だけ線にすると行き止まりになるので、両方とも線になります。',
  },
  {
    id: 'three-three',
    category: 'numbers', level: 3,
    title: '3 と 3 がとなり合う',
    rows: 3, cols: 4, anchor: 'interior',
    clues: [[1, 1, 3], [1, 2, 3]],
    given: [],
    conclude: [
      ['v', 1, 1, 'line'], ['v', 1, 3, 'line'],
      ['v', 0, 2, 'cross'], ['v', 2, 2, 'cross'],
    ],
    why: '外側の縦 2 辺が線、そして 2 つのマスの境目から上下へ伸びる辺が × になります。境目の辺を線にすると、その両端の交点で線が 3 本集まってしまうからです。まん中の境目も、ふつうは線で確定します（下記）。',
    caution: 'まん中の境目が線になるのは「輪はひとつだけ」というルールのおかげです。2 マスをまとめて囲む長方形の輪でも 3 と 3 自体は成立してしまうので、その長方形が答えそのものになりうる盤面（ほかの数字がすべて 0 か、数字が無い）でだけ、まん中は決まりません。ふつうの問題ではどこかに 1・2・3 があるため、必ず線になります。',
    // 「輪はひとつだけ」に頼る結論。下の小さな輪が答えになりえないときだけ使える。
    smallLoop: [
      ['h', 1, 1], ['h', 1, 2], ['h', 2, 1], ['h', 2, 2], ['v', 1, 1], ['v', 1, 3],
    ],
    loopConclude: [['v', 1, 2, 'line']],
  },
  {
    id: 'three-three-diagonal',
    category: 'numbers', level: 3,
    title: '3 と 3 が斜めに並ぶ',
    rows: 4, cols: 4, anchor: 'interior',
    clues: [[1, 1, 3], [2, 2, 3]],
    given: [],
    conclude: [
      ['h', 1, 1, 'line'], ['v', 1, 1, 'line'],
      ['h', 3, 2, 'line'], ['v', 2, 3, 'line'],
      ['h', 1, 0, 'cross'], ['v', 0, 1, 'cross'],
      ['h', 3, 3, 'cross'], ['v', 3, 3, 'cross'],
    ],
    why: '2 つの 3 が接する角から見て、それぞれ「外側」にあたる 2 辺が線になります。内側を削ると必ずどちらかの 3 が足りなくなるためです。その角はもう 2 本使っているので、さらに外へ伸びる辺は × になります。3 が斜めに続くときは、同じ形がそのまま連鎖します。',
  },
  {
    id: 'three-three-three',
    category: 'numbers', level: 4,
    title: '3 が 3 つ並ぶ',
    rows: 3, cols: 5, anchor: 'interior',
    clues: [[1, 1, 3], [1, 2, 3], [1, 3, 3]],
    given: [],
    conclude: [
      ['v', 1, 1, 'line'], ['v', 1, 2, 'line'], ['v', 1, 3, 'line'], ['v', 1, 4, 'line'],
      ['v', 0, 2, 'cross'], ['v', 0, 3, 'cross'], ['v', 2, 2, 'cross'], ['v', 2, 3, 'cross'],
    ],
    why: '3 がまっすぐ 3 つ並ぶと、縦の 4 辺がすべて線になります。となり合う 3 と 3 の形が重なった結果で、まん中 2 本は「どちらの 3 から見ても外側」になるため確定します。境目から上下へ伸びる辺はすべて × です。',
  },
  {
    id: 'three-zero-three',
    category: 'numbers', level: 4,
    title: '3 と 3 のあいだに 0',
    rows: 3, cols: 5, anchor: 'interior',
    clues: [[1, 1, 3], [1, 2, 0], [1, 3, 3]],
    given: [],
    conclude: [
      ['h', 1, 1, 'line'], ['h', 2, 1, 'line'], ['v', 1, 1, 'line'],
      ['h', 1, 3, 'line'], ['h', 2, 3, 'line'], ['v', 1, 4, 'line'],
      ['v', 0, 2, 'line'], ['v', 2, 2, 'line'], ['v', 0, 3, 'line'], ['v', 2, 3, 'line'],
      ['h', 1, 2, 'cross'], ['h', 2, 2, 'cross'], ['v', 1, 2, 'cross'], ['v', 1, 3, 'cross'],
      ['h', 1, 0, 'cross'], ['h', 2, 0, 'cross'], ['v', 0, 1, 'cross'], ['v', 2, 1, 'cross'],
      ['h', 1, 4, 'cross'], ['h', 2, 4, 'cross'], ['v', 0, 4, 'cross'], ['v', 2, 4, 'cross'],
    ],
    why: '0 のまわりが全部 × になるので、両側の 3 はそれぞれ残り 3 辺をすべて使います。するとコの字が向かい合う形になり、その先の交点も次々に埋まって、一度に 22 本が決まります。見つけたら最優先で処理したい形です。',
  },

  {
    id: 'knight-zero-two-zero',
    category: 'numbers', level: 4,
    title: '2 をはさんで 0 が桂馬の位置に 2 つ',
    rows: 5, cols: 5, anchor: 'interior',
    clues: [[1, 1, 0], [2, 2, 2], [2, 3, 0]],
    given: [],
    conclude: [
      ['h', 2, 2, 'line'], ['v', 1, 3, 'line'], ['v', 2, 2, 'line'],
      ['h', 1, 1, 'cross'], ['h', 2, 1, 'cross'], ['h', 2, 3, 'cross'],
      ['h', 3, 2, 'cross'], ['h', 3, 3, 'cross'],
      ['v', 1, 1, 'cross'], ['v', 1, 2, 'cross'], ['v', 2, 3, 'cross'],
      ['v', 2, 4, 'cross'], ['v', 3, 3, 'cross'],
    ],
    why: '2 の斜め前と横に 0 があると、2 のまわりで線が通れる場所がぐっと減り、2 本の行き先が 1 通りに決まります。0 が 2 つぶん効くので、一度に 13 本が片づきます。',
  },
  {
    id: 'three-three-two',
    category: 'numbers', level: 5,
    title: 'となり合う 3 と 3 の下に 2',
    rows: 3, cols: 3, anchor: 'interior',
    clues: [[1, 1, 3], [1, 2, 3], [2, 1, 2]],
    given: [],
    conclude: [
      ['v', 1, 1, 'line'], ['v', 1, 2, 'line'], ['v', 1, 3, 'line'], ['h', 3, 1, 'line'],
      ['h', 2, 0, 'cross'], ['v', 0, 2, 'cross'], ['v', 2, 2, 'cross'],
    ],
    why: 'となり合う 3 と 3 だけでは決まらなかった「まん中の境目」が、下の 2 のおかげで線に決まります。さらに 2 の反対がわの辺まで確定します。3 と 3 を見つけたら、まわりに 2 がないか探す価値があります。',
  },
  {
    id: 'three-three-diagonal-two',
    category: 'numbers', level: 5,
    title: '斜めの 3 と 3 のあいだに 2',
    rows: 4, cols: 4, anchor: 'interior',
    clues: [[1, 1, 3], [2, 2, 3], [1, 2, 2]],
    given: [],
    conclude: [
      ['h', 1, 1, 'line'], ['v', 1, 1, 'line'], ['h', 3, 2, 'line'], ['v', 2, 3, 'line'],
      ['h', 1, 0, 'cross'], ['v', 0, 1, 'cross'], ['h', 3, 3, 'cross'], ['v', 3, 3, 'cross'],
      ['h', 2, 3, 'cross'], ['v', 0, 2, 'cross'],
    ],
    why: '斜めの 3 と 3 で決まる形に、あいだの 2 が効いて × が 2 つ増えます。2 のまわりで線を引ける場所が限られるためです。',
  },

  // ---------------- 線や × が来たとき ----------------
  {
    id: 'corner-crosses-three',
    category: 'incoming', level: 3,
    title: '3 の角の外側が × 2 つ',
    rows: 3, cols: 3, anchor: 'interior',
    clues: [[1, 1, 3]],
    given: [['h', 1, 0, 'cross'], ['v', 0, 1, 'cross']],
    conclude: [['h', 1, 1, 'line'], ['v', 1, 1, 'line']],
    why: 'その角に外から線が来られないので、角に集まる線はマス側の 2 辺だけ。交点の線は 0 本か 2 本なので、この 2 辺は「両方とも線」か「両方とも ×」です。両方 × にすると 3 が足りなくなるため、両方とも線で確定します。',
  },
  {
    id: 'corner-crosses-one',
    category: 'incoming', level: 3,
    title: '1 の角の外側が × 2 つ',
    rows: 3, cols: 3, anchor: 'interior',
    clues: [[1, 1, 1]],
    given: [['h', 1, 0, 'cross'], ['v', 0, 1, 'cross']],
    conclude: [['h', 1, 1, 'cross'], ['v', 1, 1, 'cross']],
    why: '3 のときと同じ理由で、この 2 辺は「両方とも線」か「両方とも ×」です。両方を線にすると 1 本しか引けない 1 を超えてしまうので、両方とも × で確定します。',
  },
  {
    id: 'two-corner-crosses',
    category: 'incoming', level: 3,
    title: '2 の角が × 2 つでふさがれた',
    rows: 3, cols: 3, anchor: 'interior',
    clues: [[1, 1, 2]],
    given: [['h', 1, 1, 'cross'], ['v', 1, 1, 'cross']],
    conclude: [
      ['h', 2, 1, 'line'], ['v', 1, 2, 'line'],
      ['h', 2, 2, 'cross'], ['v', 2, 2, 'cross'],
    ],
    why: '2 本必要なのに 2 辺がふさがれたので、残った 2 辺を使うしかありません。その 2 本が出会う角はもう 2 本使っているので、そこから外へ伸びる辺は × になります。数字のまわりで × が増えてきたら、いつもこの形を探します。',
  },
  {
    id: 'line-into-three',
    category: 'incoming', level: 4,
    title: '3 の角に線が入ってきた',
    rows: 3, cols: 3, anchor: 'interior',
    clues: [[1, 1, 3]],
    given: [['h', 1, 0, 'line']],
    conclude: [
      ['h', 2, 1, 'line'], ['v', 1, 2, 'line'],
      ['v', 0, 1, 'cross'], ['h', 2, 2, 'cross'], ['v', 2, 2, 'cross'],
    ],
    why: '入ってきた線はその角で必ず曲がるので、3 の 4 辺のうちその角に接する 2 辺は、どちらか一方だけが線になります。3 は 3 本必要なので、残る「遠い側」の 2 辺は両方とも線です。入ってきた角はこれで 2 本使い切るため、そこから先へ伸びる辺は × になります。',
  },
  {
    id: 'line-into-one',
    category: 'incoming', level: 4,
    title: '1 の角に線が入ってきた',
    rows: 3, cols: 3, anchor: 'interior',
    clues: [[1, 1, 1]],
    given: [['h', 1, 0, 'line'], ['v', 0, 1, 'cross']],
    conclude: [['h', 2, 1, 'cross'], ['v', 1, 2, 'cross']],
    why: '入ってきた線の行き先が 1 のマスの 2 辺しか残っていないので、1 が使える 1 本はその角で消費されます。遠い側の 2 辺は × で確定です。線が入ってきただけでは決まらず、反対側がふさがっていることがポイントです。',
  },
  {
    id: 'lines-into-two',
    category: 'incoming', level: 4,
    title: '2 の角へ 2 方向から線が来た',
    rows: 3, cols: 3, anchor: 'interior',
    clues: [[1, 1, 2]],
    given: [['h', 1, 0, 'line'], ['v', 0, 1, 'line']],
    conclude: [
      ['h', 1, 1, 'cross'], ['v', 1, 1, 'cross'],
      ['h', 2, 1, 'line'], ['v', 1, 2, 'line'],
      ['h', 2, 2, 'cross'], ['v', 2, 2, 'cross'],
    ],
    why: 'その角はもう線が 2 本集まっているので、マス側の 2 辺は両方 × です。2 は 2 本必要なので、残った遠い側の 2 辺が線で確定します。さらにその 2 本が出会う角も 2 本使い切るため、先へ伸びる辺は × です。',
  },

  // ---------------- 輪をつくるルール ----------------
  {
    id: 'closed-area',
    category: 'loop', level: 4, match: 'bridge',
    title: '閉じ込められた場所には入れない',
    rows: 3, cols: 3, anchor: 'none',
    clues: [],
    given: [
      ['v', 0, 1, 'cross'], ['h', 1, 2, 'cross'], ['v', 0, 2, 'cross'], ['h', 2, 0, 'cross'],
      ['v', 2, 1, 'cross'], ['h', 2, 2, 'cross'], ['v', 2, 2, 'cross'],
    ],
    conclude: [['h', 1, 0, 'cross']],
    why: '線は必ず輪の一部なので、どこかで元の場所へ戻ってこられなければなりません。図の辺を通ると、その先は × で囲まれた行き止まりの区画に入るだけで、戻ってくる道がありません。だからこの辺は × です。「そこを通ると戻れない」辺は、× が増えるほど現れます。交点ごとの数え上げでは見つからない形なので、行き詰まったときに効きます。',
  },
  {
    id: 'no-small-loop',
    category: 'loop', level: 5,
    title: '小さな輪を閉じてはいけない',
    rows: 4, cols: 4, anchor: 'none', match: 'loop',
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
