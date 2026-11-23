"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { questionRow, questionsError } from "@/lib/domain/question";
import { countWords, normalizeLines, normalizeSpaces } from "@/lib/domain/text";
import type { Question, Sentence } from "@/lib/domain/types";
import { requireTeacher } from "@/lib/server/auth";
import { db, IMAGE_BUCKET } from "@/lib/server/db";
import {
  getProblemWithSentences,
  listQuestions,
  problemHasAttempts,
} from "@/lib/server/queries";

const questionHead = {
  label: z.string().trim().max(10),
  instruction: z.string().trim().max(1000),
};

const saveSchema = z.object({
  problemId: z.uuid(),
  title: z.string().trim().min(1, "タイトルを入力してください").max(200),
  year: z.string().trim().max(40),
  questionNo: z.string().trim().max(40),
  instruction: z.string().trim().max(1000),
  paragraphs: z
    .array(
      z.object({
        sentences: z
          .array(
            z
              .object({
                id: z.uuid().nullable(),
                kind: z.enum(["sentence", "blank", "choice"]),
                label: z
                  .string()
                  .trim()
                  .max(10)
                  .nullable()
                  .transform((v) => v || null),
                text: z.string(),
              })
              // 文挿入の選択肢の一覧は1行に1つずつ並べるので、改行を残す
              .transform((s) => ({
                ...s,
                text:
                  s.kind === "choice"
                    ? normalizeLines(s.text)
                    : normalizeSpaces(s.text),
              }))
              .refine((s) => s.kind === "blank" || s.text !== "", {
                message: "空の文があります",
              })
              .refine((s) => s.kind !== "blank" || s.label !== null, {
                message: "番号のない空所があります",
              }),
          )
          .min(1, "空の段落があります"),
      }),
    )
    .min(1, "本文がありません"),
  questions: z.array(
    z.discriminatedUnion("kind", [
      z.object({ ...questionHead, kind: z.literal("insertion") }),
      z.object({
        ...questionHead,
        kind: z.literal("word_order"),
        words: z
          .array(z.string())
          .transform((ws) => ws.map(normalizeSpaces).filter(Boolean)),
      }),
    ]),
  ),
});

export type SaveInput = z.input<typeof saveSchema>;
export type SaveResult =
  | { ok: true; sentences: Sentence[]; questions: Question[] }
  | { ok: false; error: string };

export async function saveProblem(input: SaveInput): Promise<SaveResult> {
  await requireTeacher();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const {
    problemId,
    title,
    year,
    questionNo,
    instruction,
    paragraphs,
    questions,
  } = parsed.data;

  const current = await getProblemWithSentences(problemId);
  if (!current) return { ok: false, error: "問題が見つかりません。" };
  const invalid = questionsError(current.problem.kind, questions);
  if (invalid) return { ok: false, error: invalid };

  const rows = paragraphs.flatMap((p, pi) =>
    p.sentences.map((s, si) => ({
      id: s.id,
      paragraph_index: pi,
      sentence_index: si,
      kind: s.kind,
      label: s.label,
      text: s.text,
      word_count: countWords(s.text),
    })),
  );

  // 記録がある問題では、文の結合・分割・段落の変更をすると過去のタイムラインが崩れるので、文面の修正だけを許す。
  // 小問は計測しないので、記録があっても変えてよい
  if (await problemHasAttempts(problemId)) {
    const same =
      current.sentences.length === rows.length &&
      current.sentences.every(
        (s, i) =>
          s.id === rows[i].id &&
          s.paragraphIndex === rows[i].paragraph_index &&
          s.sentenceIndex === rows[i].sentence_index,
      );
    if (!same) {
      return {
        ok: false,
        error: "取り組みの記録があるため、文や段落の区切りは変更できません。",
      };
    }
  }

  const { error } = await db().rpc("save_problem", {
    p_problem_id: problemId,
    p_title: title,
    p_year: year,
    p_question_no: questionNo,
    p_source_path: null,
    p_sentences: rows,
    p_instruction: instruction,
    p_questions: questions.map(questionRow),
  });
  if (error) {
    console.error("save_problem failed", error);
    return { ok: false, error: "保存できませんでした。" };
  }

  revalidatePath("/");
  const [fresh, freshQuestions] = await Promise.all([
    getProblemWithSentences(problemId),
    listQuestions(problemId),
  ]);
  return {
    ok: true,
    sentences: fresh?.sentences ?? [],
    questions: freshQuestions,
  };
}

/**
 * 問題を、文・小問・取り組みの記録ごと削除する。
 * 取り込み元の画像も、どこからも参照されなくなるので消す。
 */
export async function deleteProblem(
  problemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireTeacher();
  const id = z.uuid().parse(problemId);
  const { data, error } = await db().rpc("delete_problem", {
    p_problem_id: id,
  });
  if (error) {
    console.error("delete problem failed", error);
    return { ok: false, error: "問題を削除できませんでした。" };
  }

  // 以前の PDF の取り込み分は別のバケットにあり、ここでは一覧が空になるので消さない
  const folder = data as string | null;
  if (folder) {
    const storage = db().storage.from(IMAGE_BUCKET);
    const { data: files } = await storage.list(folder);
    const paths = (files ?? []).map((f) => `${folder}/${f.name}`);
    // 画像が残っても問題の削除は済んでいるので、失敗は記録だけにして画面は進める
    const { error: removeError } =
      paths.length > 0 ? await storage.remove(paths) : { error: null };
    if (removeError) console.error("remove images failed", removeError);
  }

  revalidatePath("/");
  revalidatePath("/compare");
  return { ok: true };
}

const blessingSchema = z.object({
  problemId: z.uuid(),
  enabled: z.boolean(),
  skimmableIds: z.array(z.uuid()).max(1000),
});

/** 加護の設定と流し読みしてよい文を保存する。計測には関わらないので、記録のある問題でも変えられる */
export async function saveBlessing(
  input: z.input<typeof blessingSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireTeacher();
  const parsed = blessingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const { problemId, enabled, skimmableIds } = parsed.data;

  const { error } = await db().rpc("save_blessing", {
    p_problem_id: problemId,
    p_enabled: enabled,
    p_skimmable_ids: skimmableIds,
  });
  if (error) {
    console.error("save_blessing failed", error);
    return { ok: false, error: "保存できませんでした。" };
  }
  revalidatePath("/");
  revalidatePath(`/admin/problems/${problemId}/blessing`);
  return { ok: true };
}
