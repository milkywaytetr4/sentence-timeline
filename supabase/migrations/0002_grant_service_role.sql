-- サーバー（service_role）にテーブルの権限を付ける。
-- 新しい Supabase プロジェクトでは public スキーマのテーブルに既定の権限が付かず、
-- RLS を通らない secret key でも permission denied (42501) になるため。
-- anon / authenticated には付けない（ブラウザからは一切アクセスさせない方針のまま）。

grant select, insert, update, delete
  on public.problems, public.sentences, public.attempts, public.events
  to service_role;
