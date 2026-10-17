-- 取り込んだ問題の、盤のまわりに書いてあった文字（問題番号や題など）。PDF の文字か OCR で読んだもの
ALTER TABLE book_problems ADD COLUMN meta TEXT;
