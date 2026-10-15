-- 問題集（管理画面で作る）と、その中の問題。
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0,  -- 遊ぶ人に見せるか（見せ方はこれから決める）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS book_problems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  position INTEGER NOT NULL,             -- 問題集の中の順番（1 から）
  code TEXT NOT NULL,                    -- 問題コード（難易度の文字つき）
  rows INTEGER NOT NULL,
  cols INTEGER NOT NULL,
  difficulty TEXT,
  clue_count INTEGER NOT NULL DEFAULT 0,
  source TEXT,                           -- 取り込んだファイルの名前（PDF なら「名前 p.3」）
  created_at INTEGER NOT NULL,
  UNIQUE (book_id, code)
);
CREATE INDEX IF NOT EXISTS book_problems_order ON book_problems (book_id, position);
