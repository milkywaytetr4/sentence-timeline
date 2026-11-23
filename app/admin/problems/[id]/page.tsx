import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/server/auth";
import {
  getProblemWithSentences,
  listQuestions,
  problemHasAttempts,
} from "@/lib/server/queries";
import { ProblemEditor } from "./ProblemEditor";

export default async function EditProblemPage({
  params,
  searchParams,
}: PageProps<"/admin/problems/[id]">) {
  await requireTeacher();
  const { id } = await params;
  const { truncated } = await searchParams;
  const data = await getProblemWithSentences(id).catch(() => null);
  if (!data) notFound();
  const [questions, locked] = await Promise.all([
    listQuestions(id),
    problemHasAttempts(id),
  ]);

  return (
    <ProblemEditor
      problem={data.problem}
      sentences={data.sentences}
      questions={questions}
      locked={locked}
      truncated={truncated === "1"}
    />
  );
}
