import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/server/auth";
import {
  getProblemWithSentences,
  problemHasAttempts,
} from "@/lib/server/queries";
import { ProblemEditor } from "./ProblemEditor";

export default async function EditProblemPage({
  params,
}: PageProps<"/admin/problems/[id]">) {
  await requireTeacher();
  const { id } = await params;
  const data = await getProblemWithSentences(id).catch(() => null);
  if (!data) notFound();
  const locked = await problemHasAttempts(id);

  return (
    <ProblemEditor
      problem={data.problem}
      sentences={data.sentences}
      locked={locked}
    />
  );
}
