import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/server/auth";
import { getProblemWithSentences } from "@/lib/server/queries";
import { BlessingEditor } from "./BlessingEditor";

export default async function EditBlessingPage({
  params,
}: PageProps<"/admin/problems/[id]/blessing">) {
  await requireTeacher();
  const { id } = await params;
  const data = await getProblemWithSentences(id).catch(() => null);
  if (!data) notFound();

  return <BlessingEditor problem={data.problem} sentences={data.sentences} />;
}
