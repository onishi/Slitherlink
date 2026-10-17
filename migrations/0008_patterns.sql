-- 解いた履歴と、問題集の解いた印に、定石を使った回数を足す（ヒントの回数と並べて残す）
ALTER TABLE history ADD COLUMN patterns INTEGER NOT NULL DEFAULT 0;
ALTER TABLE book_solved ADD COLUMN patterns INTEGER NOT NULL DEFAULT 0;
