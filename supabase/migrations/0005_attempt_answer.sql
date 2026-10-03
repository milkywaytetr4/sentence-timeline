-- 解答（答案の文面）を取り組みに記録する。
-- 1回の取り組みにつき解答は1つなので、別テーブルにせず attempts の列にする。
-- 解答完了の前は null のまま。
alter table public.attempts add column answer text;

-- 引数を増やすので作り直す（create or replace では引数を変えられない）
drop function public.apply_events(uuid, jsonb, uuid[]);

-- 端末から届いたイベントと取り消し（voided 化）、解答をまとめて反映し、取り組みの状態を更新する。
-- p_events: [{id, seq, type, sentence_id, client_ts}]、p_void_ids: [uuid]
-- p_answer: null なら解答を変えない。解答完了を取り消しても解答は消さず、次の解答完了で上書きする。
-- 既定値を付けるのは、このマイグレーションの適用後、デプロイ前のアプリ（p_answer を渡さない）からも呼べるようにするため
create function public.apply_events(
  p_attempt_id uuid,
  p_events jsonb,
  p_void_ids uuid[],
  p_answer text default null
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_problem_id uuid;
  v_finish timestamptz;
begin
  select problem_id into v_problem_id
    from public.attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_events) as e (sentence_id uuid)
     where e.sentence_id is not null
       and not exists (
         select 1 from public.sentences s
          where s.id = e.sentence_id and s.problem_id = v_problem_id
       )
  ) then
    raise exception 'sentence does not belong to the problem' using errcode = '22023';
  end if;

  insert into public.events (id, attempt_id, seq, type, sentence_id, client_ts)
  select e.id, p_attempt_id, e.seq, e.type, e.sentence_id, e.client_ts
    from jsonb_to_recordset(p_events)
      as e (id uuid, seq integer, type text, sentence_id uuid, client_ts timestamptz)
  on conflict (id) do nothing;

  update public.events
     set voided = true
   where attempt_id = p_attempt_id and id = any (p_void_ids) and type <> 'start';

  select client_ts into v_finish
    from public.events
   where attempt_id = p_attempt_id and type = 'finish' and not voided
   order by seq desc
   limit 1;

  update public.attempts
     set status = case
           when v_finish is not null then 'done'
           when status = 'done' then 'in_progress'
           else status
         end,
         finished_at = v_finish,
         answer = coalesce(p_answer, answer)
   where id = p_attempt_id;
end;
$$;

revoke execute on function public.apply_events(uuid, jsonb, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.apply_events(uuid, jsonb, uuid[], text) to service_role;
