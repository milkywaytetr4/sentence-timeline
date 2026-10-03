-- 取り組みを一時停止の状態で始める。計測画面に移ってから問題に取り組むタイミングを
-- 本人が選べるようにするため、start と同じ時刻に pause を登録し、「開始」（resume）で計測を始める。
-- start に一時停止の意味を持たせず pause を別に入れるのは、既存の取り組みの記録
-- （start の直後から計測している）の解釈を変えないため。
create or replace function public.start_attempt(
  p_problem_id uuid,
  p_role text,
  p_event_id uuid,
  p_client_ts timestamptz
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_no integer;
begin
  perform 1 from public.problems where id = p_problem_id for update;
  if not found then
    raise exception 'problem not found' using errcode = 'P0002';
  end if;

  update public.attempts
     set status = 'abandoned'
   where problem_id = p_problem_id and role = p_role and status = 'in_progress';

  select coalesce(max(attempt_no), 0) + 1 into v_no
    from public.attempts
   where problem_id = p_problem_id and role = p_role;

  insert into public.attempts (problem_id, role, attempt_no, status, started_at)
  values (p_problem_id, p_role, v_no, 'in_progress', p_client_ts)
  returning id into v_attempt_id;

  insert into public.events (id, attempt_id, seq, type, client_ts)
  values
    (p_event_id, v_attempt_id, 0, 'start', p_client_ts),
    (gen_random_uuid(), v_attempt_id, 1, 'pause', p_client_ts);

  return v_attempt_id;
end;
$$;
