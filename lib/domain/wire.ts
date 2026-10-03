import { z } from "zod";

/** 端末からサーバーへ送るイベント1件 */
export const wireEventSchema = z
  .object({
    id: z.uuid(),
    seq: z.int().min(1),
    type: z.enum([
      "finish",
      "focus",
      "read_done",
      "unfocus",
      "pause",
      "resume",
    ]),
    sentenceId: z.uuid().nullable(),
    clientTs: z.iso.datetime({ offset: true }),
  })
  .refine((e) => (e.type === "focus") === (e.sentenceId !== null), {
    message: "sentenceId は focus のときだけ指定します",
  });

export type WireEvent = z.infer<typeof wireEventSchema>;

/** 送信待ちキューの1件。Undo は行を消さず、対象イベントの voided を立てる操作として送る */
export const queueOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("event"), event: wireEventSchema }),
  z.object({ op: z.literal("void"), eventId: z.uuid() }),
]);

export type QueueOp = z.infer<typeof queueOpSchema>;

export const eventBatchSchema = z.object({
  ops: z.array(queueOpSchema).min(1).max(500),
});
