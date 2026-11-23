-- 加護（主張を押さえるために読むべき文と、流し読みしてよい文の区別）を持たせる。
--
-- - sentences.skimmable: 流し読みしてよい文。本文の文（kind = 'sentence'）にだけ立てる
-- - problems.blessing_enabled: これ以降に始める取り組みを、ロールを問わず加護ありにするか
-- - attempts.blessed: 取り組みが加護ありで行われたか。開始の時点で決め、あとから問題の設定を変えても変えない
--
-- どの文を流し読みしてよいとしたかは取り組みごとに残さない。比較画面で明示するのは
-- 加護ありかどうかだけで、そのときの区別を再現する必要がないため。

alter table public.sentences add column skimmable boolean not null default false;
alter table public.problems add column blessing_enabled boolean not null default false;
alter table public.attempts add column blessed boolean not null default false;

-- 開始時に加護ありかを決める。流し読みしてよい文が1つもなければ、画面は加護なしと変わらないので加護なしとして記録する
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
  v_blessed boolean;
begin
  select p.blessing_enabled
         and exists (
           select 1 from public.sentences s
            where s.problem_id = p.id and s.skimmable
         )
    into v_blessed
    from public.problems p
   where p.id = p_problem_id
     for update;
  if not found then
    raise exception 'problem not found' using errcode = 'P0002';
  end if;

  update public.attempts
     set status = 'abandoned'
   where problem_id = p_problem_id and role = p_role and status = 'in_progress';

  select coalesce(max(attempt_no), 0) + 1 into v_no
    from public.attempts
   where problem_id = p_problem_id and role = p_role;

  insert into public.attempts (problem_id, role, attempt_no, status, started_at, blessed)
  values (p_problem_id, p_role, v_no, 'in_progress', p_client_ts, v_blessed)
  returning id into v_attempt_id;

  insert into public.events (id, attempt_id, seq, type, client_ts)
  values
    (p_event_id, v_attempt_id, 0, 'start', p_client_ts),
    (gen_random_uuid(), v_attempt_id, 1, 'pause', p_client_ts);

  return v_attempt_id;
end;
$$;

-- 加護の設定と、流し読みしてよい文をまとめて保存する。
-- p_skimmable_ids に無い文は流し読みしない文に戻す。空所と選択肢の id は無視する
create function public.save_blessing(
  p_problem_id uuid,
  p_enabled boolean,
  p_skimmable_ids uuid[]
) returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.problems
     set blessing_enabled = p_enabled
   where id = p_problem_id;
  if not found then
    raise exception 'problem not found' using errcode = 'P0002';
  end if;

  update public.sentences
     set skimmable = (kind = 'sentence' and id = any (p_skimmable_ids))
   where problem_id = p_problem_id;
end;
$$;

revoke execute on function public.save_blessing(uuid, boolean, uuid[])
  from public, anon, authenticated;
grant execute on function public.save_blessing(uuid, boolean, uuid[]) to service_role;
