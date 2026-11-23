-- 問題を削除する。取り込み元の画像を消せるよう、source_path を返す（問題がなければ null）。
--
-- problems を消すだけでは、記録のある問題を消せない。cascade は sentences と attempts への削除を
-- 別々に実行し、外部キーの確認もそれぞれの削除ごとに行うため、sentences を消した時点で、
-- まだ消えていない events が文を参照していて失敗する。そこで取り組み（と events）を先に消す。
-- events.sentence_id を on delete cascade にしないのは、編集で記録のある文を消せないようにするため（0001 を参照）
create function public.delete_problem(p_problem_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_source_path text;
begin
  delete from public.attempts where problem_id = p_problem_id;
  delete from public.problems where id = p_problem_id
  returning source_path into v_source_path;
  return v_source_path;
end;
$$;

revoke execute on function public.delete_problem(uuid) from public, anon, authenticated;
grant execute on function public.delete_problem(uuid) to service_role;
