-- 問題集の問題を、だれが解いたか。解いた履歴（history）は件数に上限があって古いものが消えるので、別に持つ。
-- ゲームで問題を解いたとき、その問題コードが公開中の問題集の問題と同じなら、ここに入れる。
CREATE TABLE IF NOT EXISTS book_solved (
  user_id TEXT NOT NULL,
  problem_id INTEGER NOT NULL,
  seconds INTEGER NOT NULL,      -- いちばん速かった時間
  hints INTEGER NOT NULL DEFAULT 0,
  solved_at INTEGER NOT NULL,    -- 初めて解いた日時
  PRIMARY KEY (user_id, problem_id)
);
