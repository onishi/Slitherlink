-- ログインした人ごとに、問題リスト・解いた履歴・自己ベスト・途中の盤面を持つ。
-- id は Google のアカウント ID（sub）。

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  picture TEXT,
  created_at INTEGER NOT NULL,
  imported_at INTEGER            -- 端末にあったデータを取り込んだ日時（1 回だけ取り込む）
);

-- ログインの状態。token はそのままでは持たず、SHA-256 だけ持つ
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS library (
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  entry TEXT NOT NULL,           -- JSON（rows, cols, difficulty, clueCount, source）
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, code)
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  rows INTEGER NOT NULL,
  cols INTEGER NOT NULL,
  difficulty TEXT,
  seconds INTEGER NOT NULL,
  hints INTEGER NOT NULL DEFAULT 0,
  solved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS history_user ON history (user_id, solved_at DESC);

CREATE TABLE IF NOT EXISTS records (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,             -- 「10x10:normal」のような、大きさと難易度
  seconds INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- 途中の盤面（1 人 1 つ）
CREATE TABLE IF NOT EXISTS games (
  user_id TEXT PRIMARY KEY,
  game TEXT NOT NULL,            -- JSON（code, edges, elapsed, solution）
  updated_at INTEGER NOT NULL
);
