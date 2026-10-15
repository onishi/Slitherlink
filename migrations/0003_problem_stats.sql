-- 問題集の問題に、難易度のほかの目安を持つ（中身は src/core/difficulty-report.js の problemStats）。
-- 入れる前に登録した問題は空（NULL）で、管理画面で開いたときに計算して埋める。
ALTER TABLE book_problems ADD COLUMN loop_length INTEGER;    -- 答えの輪の長さ（線の本数）
ALTER TABLE book_problems ADD COLUMN pattern_share INTEGER;  -- 定石だけで決まる辺の割合（%）
ALTER TABLE book_problems ADD COLUMN free_share INTEGER;     -- 最初に仮定が要るまでに決まる割合（%）
ALTER TABLE book_problems ADD COLUMN assume_count INTEGER;   -- 仮定が要る回数
ALTER TABLE book_problems ADD COLUMN longest_steps INTEGER;  -- いちばん長い読みの手数
