-- 計測画面で本文の上に出す設問文を、問題ごとに持たせる。
-- 既存の問題には、これまで画面に固定で出していた文言を入れる。
alter table public.problems
  add column instruction text not null
  default '次の英文の要旨を、70〜80字の日本語でまとめよ。';

-- 引数を増やすので作り直す（create or replace では引数を変えられない）
drop function public.save_problem(uuid, text, text, text, text, jsonb);

-- 問題と文を保存する。p_problem_id が null なら新規作成。
-- p_sentences: [{id (null可), paragraph_index, sentence_index, text, word_count}]
-- p_instruction: null なら設問文を変えない（新規作成では列の既定値になる）。
-- 既定値を付けるのは、取り込み（設問文を入力しない）と、このマイグレーションの適用後、
-- デプロイ前のアプリからも呼べるようにするため
-- 一覧に無い既存の文は削除する。記録のある文を消そうとすると外部キー制約で失敗する。
create function public.save_problem(
  p_problem_id uuid,
  p_title text,
  p_year text,
  p_question_no text,
  p_source_path text,
  p_sentences jsonb,
  p_instruction text default null
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
         instruction = coalesce(p_instruction, instruction)
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

revoke execute on function public.save_problem(uuid, text, text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.save_problem(uuid, text, text, text, text, jsonb, text) to service_role;
