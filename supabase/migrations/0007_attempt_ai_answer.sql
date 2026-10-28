-- 解答の書き口を残して LLM が改稿した解答を、取り組みに記録する。
-- 残すのは最新の1回だけなので、別テーブルにせず attempts の列にする。
-- 添削の指摘事項は画面に出さないので保存しない。改稿していなければ null のまま。
alter table public.attempts add column ai_answer text;
