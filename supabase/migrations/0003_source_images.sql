-- 取り込み元を PDF 1枚からスクリーンショット複数枚に切り替える。
-- 画像は problem-images バケットの「<uuid>/<連番>.<拡張子>」に置き、
-- problems.source_path にはそのフォルダ名（<uuid>）を入れる。
-- 既存の problem-pdfs バケットと、そこを指す値は過去の取り込み分として残す。

alter table public.problems rename column source_pdf_path to source_path;

-- 引数名は create or replace で変えられないため、作り直す
drop function public.save_problem(uuid, text, text, text, text, jsonb);

-- 問題と文を保存する。p_problem_id が null なら新規作成。
-- p_sentences: [{id (null可), paragraph_index, sentence_index, text, word_count}]
-- 一覧に無い既存の文は削除する。記録のある文を消そうとすると外部キー制約で失敗する。
create function public.save_problem(
  p_problem_id uuid,
  p_title text,
  p_year text,
  p_question_no text,
  p_source_path text,
  p_sentences jsonb
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

revoke execute on function public.save_problem(uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_problem(uuid, text, text, text, text, jsonb) to service_role;

-- 取り込み用画像の置き場。private バケットにする。
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('problem-images', 'problem-images', false, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;
