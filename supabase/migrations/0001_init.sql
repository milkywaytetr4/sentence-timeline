-- 1a 読解タイムライン 初期スキーマ
--
-- ブラウザからは Supabase に一切アクセスしない。全テーブルで RLS を有効にし、
-- ポリシーは作らない（anon / publishable キーでは何も読めず、何も書けない）。
-- アクセスは Next.js サーバーから secret key（service_role 相当）で行う。

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  year text not null default '',
  question_no text not null default '',
  source_pdf_path text,
  created_at timestamptz not null default now()
);

create table public.sentences (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems (id) on delete cascade,
  paragraph_index integer not null check (paragraph_index >= 0),
  sentence_index integer not null check (sentence_index >= 0),
  text text not null,
  word_count integer not null check (word_count >= 0)
);

create index sentences_problem_order_idx
  on public.sentences (problem_id, paragraph_index, sentence_index);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems (id) on delete cascade,
  role text not null check (role in ('teacher', 'student')),
  attempt_no integer not null check (attempt_no >= 1),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'done', 'abandoned')),
  started_at timestamptz not null,
  finished_at timestamptz,
  unique (problem_id, role, attempt_no)
);

-- id は端末側で採番する。再送しても同じ行になるので、重複登録を防げる。
create table public.events (
  id uuid primary key,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  seq integer not null check (seq >= 0),
  type text not null
    check (type in ('start', 'finish', 'focus', 'read_done', 'unfocus', 'pause', 'resume')),
  -- sentences 側を on delete cascade にしないのは、記録のある文を消せないようにするため
  sentence_id uuid references public.sentences (id),
  client_ts timestamptz not null,
  voided boolean not null default false,
  received_at timestamptz not null default now(),
  unique (attempt_id, seq),
  check ((type = 'focus') = (sentence_id is not null))
);

create index events_sentence_idx on public.events (sentence_id);

alter table public.problems enable row level security;
alter table public.sentences enable row level security;
alter table public.attempts enable row level security;
alter table public.events enable row level security;

revoke all on public.problems, public.sentences, public.attempts, public.events
  from anon, authenticated;

-- 取り組みを開始する。回数の採番、同じ問題・ロールの中断中の取り組みの打ち切り、
-- start イベントの登録を1トランザクションで行う。
create function public.start_attempt(
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
  values (p_event_id, v_attempt_id, 0, 'start', p_client_ts);

  return v_attempt_id;
end;
$$;

-- 端末から届いたイベントと取り消し（voided 化）をまとめて反映し、取り組みの状態を更新する。
-- p_events: [{id, seq, type, sentence_id, client_ts}]、p_void_ids: [uuid]
create function public.apply_events(
  p_attempt_id uuid,
  p_events jsonb,
  p_void_ids uuid[]
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
         finished_at = v_finish
   where id = p_attempt_id;
end;
$$;

-- 問題と文を保存する。p_problem_id が null なら新規作成。
-- p_sentences: [{id (null可), paragraph_index, sentence_index, text, word_count}]
-- 一覧に無い既存の文は削除する。記録のある文を消そうとすると外部キー制約で失敗する。
create function public.save_problem(
  p_problem_id uuid,
  p_title text,
  p_year text,
  p_question_no text,
  p_source_pdf_path text,
  p_sentences jsonb
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := p_problem_id;
begin
  if v_id is null then
    insert into public.problems (title, year, question_no, source_pdf_path)
    values (p_title, p_year, p_question_no, p_source_pdf_path)
    returning id into v_id;
  else
    update public.problems
       set title = p_title, year = p_year, question_no = p_question_no
     where id = v_id;
    if not found then
      raise exception 'problem not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.sentences s
   where s.problem_id = v_id
     and s.id not in (
       select (x ->> 'id')::uuid
         from jsonb_array_elements(p_sentences) as x
        where x ->> 'id' is not null
     );

  update public.sentences s
     set paragraph_index = e.paragraph_index,
         sentence_index = e.sentence_index,
         text = e.text,
         word_count = e.word_count
    from jsonb_to_recordset(p_sentences)
      as e (id uuid, paragraph_index integer, sentence_index integer, text text, word_count integer)
   where e.id is not null and s.id = e.id and s.problem_id = v_id;

  insert into public.sentences (problem_id, paragraph_index, sentence_index, text, word_count)
  select v_id, e.paragraph_index, e.sentence_index, e.text, e.word_count
    from jsonb_to_recordset(p_sentences)
      as e (id uuid, paragraph_index integer, sentence_index integer, text text, word_count integer)
   where e.id is null;

  return v_id;
end;
$$;

-- public スキーマの関数は既定で誰でも実行できるため、サーバー（service_role）以外から取り上げる
revoke execute on function public.start_attempt(uuid, text, uuid, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.apply_events(uuid, jsonb, uuid[])
  from public, anon, authenticated;
revoke execute on function public.save_problem(uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_attempt(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.apply_events(uuid, jsonb, uuid[]) to service_role;
grant execute on function public.save_problem(uuid, text, text, text, text, jsonb) to service_role;

-- 取り込み用PDFの置き場。private バケットにする。
insert into storage.buckets (id, name, public)
values ('problem-pdfs', 'problem-pdfs', false)
on conflict (id) do nothing;
