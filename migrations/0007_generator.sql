-- 自動作問の問題に、どの版の作問ロジックで作ったかを持つ（src/core/generator.js の GENERATORS）。
--   random-1  ランダム v1 ／ teacher-1  教師データ v1 ／ teacher-2  教師データ v2
-- スキャンの問題は NULL。すでにある自動作問の問題は、名前から版を決める
-- （「ランダム …」はランダム v1、「教師データ …」は、2 版ができる前に作ったので教師データ v1）。
ALTER TABLE book_problems ADD COLUMN generator TEXT;
UPDATE book_problems SET generator = 'random-1' WHERE origin = 'generated' AND generator IS NULL AND source LIKE 'ランダム %';
UPDATE book_problems SET generator = 'teacher-1' WHERE origin = 'generated' AND generator IS NULL AND source LIKE '教師データ %';
