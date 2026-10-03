"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  clearSessionCookie,
  requireRole,
  requireTeacher,
} from "@/lib/server/auth";
import { db } from "@/lib/server/db";

const startSchema = z.object({
  problemId: z.uuid(),
  eventId: z.uuid(),
  clientTs: z.iso.datetime({ offset: true }),
});

/**
 * 新しい取り組みを始める。start イベントの時刻はタップした端末の時刻を使う。
 * 同じ問題で中断したままの自分の取り組みは「未完了」として打ち切られる。
 */
export async function startAttempt(
  input: z.input<typeof startSchema>,
): Promise<{ attemptId: string } | { error: string }> {
  const role = await requireRole();
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { error: "入力が不正です。" };

  const { data, error } = await db().rpc("start_attempt", {
    p_problem_id: parsed.data.problemId,
    p_role: role,
    p_event_id: parsed.data.eventId,
    p_client_ts: parsed.data.clientTs,
  });
  if (error) {
    console.error("start_attempt failed", error);
    return { error: "取り組みを開始できませんでした。" };
  }
  revalidatePath("/");
  return { attemptId: data as string };
}

export async function deleteAttempt(attemptId: string) {
  await requireTeacher();
  const id = z.uuid().parse(attemptId);
  const { error } = await db().from("attempts").delete().eq("id", id);
  if (error) {
    console.error("delete attempt failed", error);
    throw new Error("取り組みを削除できませんでした。");
  }
  revalidatePath("/");
  revalidatePath("/compare");
}

export async function leave() {
  await clearSessionCookie();
  redirect("/enter");
}
