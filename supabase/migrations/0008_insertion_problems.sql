-- 第1問(B)（段落挿入・文挿入）を扱えるようにする。
--
-- 空所と選択肢も sentences の行として持たせる。計測は「どの行を見ているか」の切り替えで行っており、
-- 選択肢を行にすれば events.sentence_id で指せるので、イベントとタイムラインの計算を変えずに済むため。
-- - kind = 'blank': 本文中の空所。label に空所の番号を入れる。段落挿入では1行で1段落、文挿入では段落の中の1文の位置に置く
-- - kind = 'choice': 選択肢。本文の段落の後ろに、選択肢ごとに1段落として置く。
--   段落挿入では選択肢1つを1行にし、label に記号を入れる。
--   文挿入では選択肢の一覧全体を1行（記号付きで1行に1つずつ改行で並べる）にし、label は null にする。
--   一覧をまとめて読む時間を1つの区間として記録するため

alter table public.problems
  add column kind text not null default 'summary'
    check (kind in ('summary', 'paragraph_insertion', 'sentence_insertion'));

alter table public.sentences
  add column kind text not null default 'sentence'
    check (kind in ('sentence', 'blank', 'choice')),
  add column label text;

-- 空所を見ている時間は計れない（読む中身がない）ので、空所を指すイベントを受け付けない
create or replace function public.apply_events(
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
          where s.id = e.sentence_id
            and s.problem_id = v_problem_id
            and s.kind <> 'blank'
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

-- 引数を増やすので作り直す（create or replace では引数を変えられない）
drop function public.save_problem(uuid, text, text, text, text, jsonb, text);

-- 問題と文を保存する。p_problem_id が null なら新規作成。
-- p_sentences: [{id (null可), paragraph_index, sentence_index, kind, label, text, word_count}]
--   kind を省いた行は 'sentence' として扱う
-- p_instruction: null なら設問文を変えない（新規作成では列の既定値になる）。
-- p_kind: null なら問題の種類を変えない（新規作成では 'summary' になる）。
-- 既定値を付けるのは、このマイグレーションの適用後、デプロイ前のアプリからも呼べるようにするため
-- 一覧に無い既存の文は削除する。記録のある文を消そうとすると外部キー制約で失敗する。
create function public.save_problem(
  p_problem_id uuid,
  p_title text,
  p_year text,
  p_question_no text,
  p_source_path text,
  p_sentences jsonb,
  p_instruction text default null,
  p_kind text default null
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := p_problem_id;
begin
  if v_id is null then
    insert into public.problems (title, year, question_no, source_path)
    values (p_title, p_year, p_question_no, p_source_path)
    returning id into v_id;
  end if;

  update public.problems
     set title = p_title,
         year = p_year,
         question_no = p_question_no,
         instruction = coalesce(p_instruction, instruction),
         kind = coalesce(p_kind, kind)
   where id = v_id;
  if not found then
    raise exception 'problem not found' using errcode = 'P0002';
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
         kind = coalesce(e.kind, 'sentence'),
         label = e.label,
         text = e.text,
         word_count = e.word_count
    from jsonb_to_recordset(p_sentences)
      as e (id uuid, paragraph_index integer, sentence_index integer, kind text, label text, text text, word_count integer)
   where e.id is not null and s.id = e.id and s.problem_id = v_id;

  insert into public.sentences (problem_id, paragraph_index, sentence_index, kind, label, text, word_count)
  select v_id, e.paragraph_index, e.sentence_index, coalesce(e.kind, 'sentence'), e.label, e.text, e.word_count
    from jsonb_to_recordset(p_sentences)
      as e (id uuid, paragraph_index integer, sentence_index integer, kind text, label text, text text, word_count integer)
   where e.id is null;

  return v_id;
end;
$$;

revoke execute on function public.save_problem(uuid, text, text, text, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.save_problem(uuid, text, text, text, text, jsonb, text, text) to service_role;
