import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { TopBar } from "@/components/ui";
import { problemLabel } from "@/lib/domain/types";
import { requireRole } from "@/lib/server/auth";
import {
  getProblemWithSentences,
  listAttemptsWithEvents,
  listProblemHeads,
} from "@/lib/server/queries";
import { CompareView } from "./CompareView";

export default async function ComparePage({
  searchParams,
}: PageProps<"/compare">) {
  await requireRole();
  const sp = await searchParams;
  const problems = await listProblemHeads();
  const requested = typeof sp.problem === "string" ? sp.problem : undefined;
  const problemId =
    problems.find((p) => p.id === requested)?.id ?? problems[0]?.id;

  const data = problemId ? await getProblemWithSentences(problemId) : null;
  const attempts = problemId ? await listAttemptsWithEvents(problemId) : [];
  const selected = (
    Array.isArray(sp.a) ? sp.a : sp.a ? sp.a.split(",") : []
  ).filter((id) => attempts.some((a) => a.id === id));

  return (
    <div className="dot-bg flex min-h-dvh flex-col">
      <TopBar>
        <Link
          href="/"
          aria-label="一覧へ"
          title="一覧へ"
          className="inline-flex size-11 flex-none items-center justify-center rounded-[10px] text-(--text-tertiary) hover:bg-(--surface-chip)"
        >
          <ChevronLeft size={22} aria-hidden />
        </Link>
        <span className="text-[18px] font-semibold whitespace-nowrap">
          比較
        </span>
      </TopBar>
      {data && problemId ? (
        <CompareView
          key={problemId}
          problemId={problemId}
          problemOptions={problems.map((p) => ({
            value: p.id,
            label: problemLabel(p),
          }))}
          sentences={data.sentences}
          attempts={attempts.map((a) => ({
            ...a,
            events: a.events.filter((e) => !e.voided),
          }))}
          initialSelected={selected}
        />
      ) : (
        <main className="p-6">
          <div className="frame p-8 text-center text-(--text-secondary)">
            まだ問題がありません。
          </div>
        </main>
      )}
    </div>
  );
}
