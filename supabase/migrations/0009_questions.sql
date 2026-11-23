-- 第1問(B)の小問（語の並べ替えなど）を、生徒がこの画面だけで問題を解けるように持たせる。
--
-- 設問文は紙面の位置で置き場を分ける。
-- - problems.instruction: 本文の前に印刷されている指示
-- - questions: 本文の後ろに印刷されている小問
--   - kind = 'insertion': 空所に段落・文を入れる小問。設問文だけを持ち、選択肢は今どおり sentences の行に置く
--     （選択肢を見ている時間を events.sentence_id で記録するため）。挿入問題に1つだけ置く
--   - kind = 'word_order': 語の並べ替え。data に {"words": [...]} を入れる
-- 小問は計測しないので、sentences と違ってイベントからは参照されない。
-- そのため保存のたびに全部消して入れ直してよく、記録のある問題でも自由に変えられる。

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems (id) on delete cascade,
  position integer not null check (position >= 0),
  label text not null default '',
  kind text not null check (kind in ('insertion', 'word_order')),
  instruction text not null default '',
  data jsonb not null default '{}'
);

create index questions_problem_order_idx on public.questions (problem_id, position);

alter table public.questions enable row level security;
revoke all on public.questions from anon, authenticated;
grant select, insert, update, delete on public.questions to service_role;

-- 既存の挿入問題は、(ア)(イ)に分かれる前の年度で、設問文が本文の前に印刷されている。
-- そのため設問文は problems.instruction に残し、設問文の空の挿入の小問だけを作る
insert into public.questions (problem_id, position, kind)
select id, 0, 'insertion'
  from public.problems
 where kind <> 'summary';

-- 引数を増やすので作り直す（create or replace では引数を変えられない）
drop function public.save_problem(uuid, text, text, text, text, jsonb, text, text);

-- 問題と文を保存する。p_problem_id が null なら新規作成。
-- p_sentences: [{id (null可), paragraph_index, sentence_index, kind, label, text, word_count}]
--   kind を省いた行は 'sentence' として扱う
-- p_instruction: null なら設問文を変えない（新規作成では列の既定値になる）。
-- p_kind: null なら問題の種類を変えない（新規作成では 'summary' になる）。
-- p_questions: [{label, kind, instruction, data}]。並び順を position にする。null なら小問を変えない
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
  p_kind text default null,
  p_questions jsonb default null
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

  if p_questions is not null then
    delete from public.questions where problem_id = v_id;
    insert into public.questions (problem_id, position, label, kind, instruction, data)
    select v_id, q.ord - 1, coalesce(q.v ->> 'label', ''), q.v ->> 'kind',
           coalesce(q.v ->> 'instruction', ''), coalesce(q.v -> 'data', '{}')
      from jsonb_array_elements(p_questions) with ordinality as q (v, ord);
  end if;

  return v_id;
end;
$$;

revoke execute on function public.save_problem(uuid, text, text, text, text, jsonb, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_problem(uuid, text, text, text, text, jsonb, text, text, jsonb) to service_role;
