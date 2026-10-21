import { notFound, redirect } from "next/navigation";
import { attemptLabel, problemLabel } from "@/lib/domain/types";
import { requireRole } from "@/lib/server/auth";
import {
  getAttemptWithEvents,
  getProblemWithSentences,
} from "@/lib/server/queries";
import { Recorder } from "./Recorder";

export default async function AttemptPage({
  params,
}: PageProps<"/attempts/[id]">) {
  const role = await requireRole();
  const { id } = await params;
  const attempt = await getAttemptWithEvents(id).catch(() => null);
  if (!attempt) notFound();

  // 相手の取り組みや終わった取り組みは記録を続けられないので、比較画面で見せる
  if (attempt.role !== role || attempt.status !== "in_progress") {
    redirect(`/compare?problem=${attempt.problemId}&a=${attempt.id}`);
  }

  const data = await getProblemWithSentences(attempt.problemId);
  if (!data) notFound();

  return (
    <Recorder
      attemptId={attempt.id}
      problemId={attempt.problemId}
      title={problemLabel(data.problem)}
      attemptName={attemptLabel(attempt)}
      instruction={data.problem.instruction}
      sentences={data.sentences}
      initialEvents={attempt.events}
      initialAnswer={attempt.answer}
    />
  );
}
