import { NextResponse } from "next/server";
import { z } from "zod";
import { eventBatchSchema } from "@/lib/domain/wire";
import { getRole } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { getAttemptOwner } from "@/lib/server/queries";

/**
 * 端末に溜まったイベントと取り消し、解答をまとめて受け取る。
 * イベントの id は端末で採番しているので、同じバッチを再送しても二重登録にはならない。
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/attempts/[id]/events">,
) {
  const role = await getRole();
  if (!role)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const owner = await getAttemptOwner(id);
  if (!owner) return NextResponse.json({ error: "not found" }, { status: 404 });
  // 記録できるのは自分のロールの取り組みだけ
  if (owner.role !== role) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = eventBatchSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return NextResponse.json(
      { error: "invalid body", issues: body.error.issues },
      { status: 400 },
    );
  }

  const events = body.data.ops.flatMap((op) =>
    op.op === "event"
      ? [
          {
            id: op.event.id,
            seq: op.event.seq,
            type: op.event.type,
            sentence_id: op.event.sentenceId,
            client_ts: op.event.clientTs,
          },
        ]
      : [],
  );
  const voidIds = body.data.ops.flatMap((op) =>
    op.op === "void" ? [op.eventId] : [],
  );
  // 解答完了を取り消して出し直した場合などに複数届くので、最後のものを使う
  const answer =
    body.data.ops
      .flatMap((op) => (op.op === "answer" ? [op.text] : []))
      .at(-1) ?? null;

  const { error } = await db().rpc("apply_events", {
    p_attempt_id: id,
    p_events: events,
    p_void_ids: voidIds,
    p_answer: answer,
  });
  if (error) {
    console.error("apply_events failed", error);
    // 入力に起因する失敗は 422 にする。端末側はどちらの場合も記録を捨てずに再送を続ける
    const permanent = error.code === "22023" || error.code === "23505";
    return NextResponse.json(
      { error: "could not apply events" },
      { status: permanent ? 422 : 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
