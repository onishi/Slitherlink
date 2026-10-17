/**
 * 「教師データ」の目安。教師データの問題集（とことん01 の 99 問）を調べて分かった特徴を、満たすかどうかの条件にしたもの。
 * 99 問のうち 98 問がすべてを満たし、このアプリのランダム作問（作り方を変える前）は 20 問中 4 問だけだった。
 *
 * 作問器の「教師データ」で合格の基準に使い、管理画面の問題一覧・問題の詳細でも当てはまるかを出す。
 */

/** 数字の配置が点対称（盤を 180° 回すと、数字のあるマスが重なる）か。数字の値は問わない。 */
export function isPointSymmetric(clues, rows, cols) {
  const n = rows * cols;
  for (let i = 0; i < n; i++) {
    if ((clues[i] >= 0) !== (clues[n - 1 - i] >= 0)) return false;
  }
  return true;
}

/**
 * 条件の一覧。[key, 名前, 満たすか(info), 条件の書き方]。
 * info は { rows, cols, clues?, clueCount, loopLength, coverage, largestGap, patternShare, assumeCount }。
 * 値が分からない（null）ときは「分からない」として扱う（満たすとも満たさないとも言わない）。
 */
export const TEACHER_RULES = [
  ['symmetric', '点対称', (p) => (p.clues ? isPointSymmetric(p.clues, p.rows, p.cols) : null), '数字の配置が点対称'],
  ['clues', '数字', (p) => (100 * p.clueCount) / (p.rows * p.cols) < 50, '数字の割合 50% 未満'],
  ['loop', '線', (p) => (p.loopLength == null ? null : p.loopLength / (p.rows * p.cols) >= 0.8), '線／マス 0.80 以上'],
  ['coverage', '行き渡り', (p) => (p.coverage == null ? null : p.coverage >= 80), '行き渡り 80% 以上'],
  ['gap', '最大の空き地', (p) => (p.largestGap == null ? null : p.largestGap <= 4), '最大の空き地 4% 以下'],
  ['pattern', '定石', (p) => (p.patternShare == null ? null : p.patternShare >= 95), '定石 95% 以上'],
  ['assume', '仮定', (p) => (p.assumeCount == null ? null : p.assumeCount <= 3), '仮定 3 回まで'],
];

/**
 * 教師データの条件に当てはまるか。
 * @returns {{ok: boolean|null, results: {key:string, label:string, about:string, pass:boolean|null}[], failed: string[]}}
 *   ok は全部満たせば true、どれか外れれば false、外れは無いが分からないものがあれば null。
 */
export function teacherCheck(info) {
  const results = TEACHER_RULES.map(([key, label, test, about]) => ({ key, label, about, pass: test(info) }));
  const failed = results.filter((r) => r.pass === false).map((r) => r.label);
  const ok = failed.length ? false : results.some((r) => r.pass == null) ? null : true;
  return { ok, results, failed };
}
