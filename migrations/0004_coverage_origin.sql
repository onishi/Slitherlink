-- 問題集の問題に、線の行き渡り率と、問題の出どころを持つ。
ALTER TABLE book_problems ADD COLUMN coverage INTEGER;  -- 線の行き渡り率（%）。4 辺のどれかが線になるマスの割合
ALTER TABLE book_problems ADD COLUMN origin TEXT;       -- 'scan'（画像・zip・PDF から読み取り）／ 'generated'（このアプリの自動作問）

-- すでに入っている問題：ランダム作問のものは名前でわかる。ほかは取り込み（スキャン）
UPDATE book_problems SET origin = CASE WHEN source LIKE 'ランダム %' THEN 'generated' ELSE 'scan' END WHERE origin IS NULL;
