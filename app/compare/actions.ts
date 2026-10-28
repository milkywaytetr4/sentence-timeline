"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import {
  getAttemptAnswer,
  getProblemWithSentences,
} from "@/lib/server/queries";
import { reviseAnswer } from "@/lib/server/revise";

/** 取り組みの解答を LLM に改稿させ、結果を取り組みに保存する。前回の改稿は上書きする */
export async function requestRevision(
  attemptId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole();
  const id = z.uuid().safeParse(attemptId);
  if (!id.success) return { ok: false, error: "入力が不正です。" };

  const attempt = await getAttemptAnswer(id.data);
  if (!attempt) return { ok: false, error: "取り組みが見つかりません。" };
  if (!attempt.answer) {
    return { ok: false, error: "解答の記録がないため、改稿できません。" };
  }
  const data = await getProblemWithSentences(attempt.problemId);
  if (!data) return { ok: false, error: "問題が見つかりません。" };
  if (data.problem.kind !== "summary") {
    return { ok: false, error: "改稿できるのは要約問題の解答だけです。" };
  }

  let aiAnswer: string;
  try {
    aiAnswer = await reviseAnswer({
      instruction: data.problem.instruction,
      sentences: data.sentences,
      answer: attempt.answer,
    });
  } catch (e) {
    console.error("revise failed", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "解答を改稿できませんでした。",
    };
  }

  const { error } = await db()
    .from("attempts")
    .update({ ai_answer: aiAnswer })
    .eq("id", id.data);
  if (error) {
    console.error("save ai answer failed", error);
    return { ok: false, error: "改稿した解答を保存できませんでした。" };
  }
  revalidatePath("/compare");
  return { ok: true };
}
