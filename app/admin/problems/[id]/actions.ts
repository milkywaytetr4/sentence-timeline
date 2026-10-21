"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { countWords, normalizeSpaces } from "@/lib/domain/text";
import type { Sentence } from "@/lib/domain/types";
import { requireTeacher } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import {
  getProblemWithSentences,
  problemHasAttempts,
} from "@/lib/server/queries";

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
            z.object({
              id: z.uuid().nullable(),
              text: z
                .string()
                .transform(normalizeSpaces)
                .pipe(z.string().min(1, "空の文があります")),
            }),
          )
          .min(1, "空の段落があります"),
      }),
    )
    .min(1, "本文がありません"),
});

export type SaveInput = z.input<typeof saveSchema>;
export type SaveResult =
  | { ok: true; sentences: Sentence[] }
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
  const { problemId, title, year, questionNo, instruction, paragraphs } =
    parsed.data;

  const rows = paragraphs.flatMap((p, pi) =>
    p.sentences.map((s, si) => ({
      id: s.id,
      paragraph_index: pi,
      sentence_index: si,
      text: s.text,
      word_count: countWords(s.text),
    })),
  );

  // 記録がある問題では、文の結合・分割・段落の変更をすると過去のタイムラインが崩れるので、文面の修正だけを許す
  if (await problemHasAttempts(problemId)) {
    const current = await getProblemWithSentences(problemId);
    const same =
      current !== null &&
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
  });
  if (error) {
    console.error("save_problem failed", error);
    return { ok: false, error: "保存できませんでした。" };
  }

  revalidatePath("/");
  const fresh = await getProblemWithSentences(problemId);
  return { ok: true, sentences: fresh?.sentences ?? [] };
}
