import {
  ChartNoAxesGantt,
  Pencil,
  Settings,
  ShieldCheck,
  Square,
  SquareCheckBig,
} from "lucide-react";
import Link from "next/link";
import { Badge, TopBar } from "@/components/ui";
import { formatDate } from "@/lib/domain/format";
import { buildTimeline, formatClock } from "@/lib/domain/timeline";
import {
  attemptLabel,
  problemLabel,
  ROLE_LABEL,
  type Role,
} from "@/lib/domain/types";
import { requireRole } from "@/lib/server/auth";
import { listProblems } from "@/lib/server/queries";
import { leave } from "./actions";
import { PendingFlusher } from "./PendingFlusher";
import { DeleteAttemptButton, ResumeLink, StartButton } from "./ProblemActions";

export default async function HomePage() {
  const role = await requireRole();
  const problems = await listProblems();

  return (
    <div className="dot-bg flex min-h-dvh flex-col">
      <PendingFlusher />
      <TopBar>
        <span className="text-[18px] leading-[1.4] font-semibold whitespace-nowrap">
          1a 読解タイムライン
        </span>
        <span className="ml-auto hidden text-[12px] font-medium whitespace-nowrap text-(--text-tertiary) sm:inline">
          {ROLE_LABEL[role]}として入場中
        </span>
        {role === "teacher" && (
          <Link
            href="/admin/import"
            className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold text-(--text-secondary) hover:bg-(--surface-chip) hover:no-underline"
          >
            <Settings size={18} aria-hidden />
            問題の取り込み
          </Link>
        )}
        <form
          action={leave}
          className={role === "teacher" ? "" : "ml-auto sm:ml-0"}
        >
          <button
            type="submit"
            className="h-10 rounded-full px-3 text-[14px] font-medium text-(--text-tertiary) hover:bg-(--surface-chip)"
          >
            退出
          </button>
        </form>
      </TopBar>

      <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-3.5 p-4 sm:p-7">
        {problems.length === 0 && (
          <div className="frame p-8 text-center text-(--text-secondary)">
            まだ問題がありません。
            {role === "teacher" && (
              <>
                {" "}
                <Link href="/admin/import">スクリーンショットから取り込む</Link>
              </>
            )}
          </div>
        )}

        {problems.map((p) => {
          const doneBy = (r: Role) =>
            p.attempts.some((a) => a.role === r && a.status === "done");
          return (
            <section
              key={p.id}
              className="flex flex-col gap-4 rounded-(--radius-20) border-[1.5px] border-(--border-subtle) bg-(--surface-card) px-6 py-5 shadow-(--shadow-1)"
            >
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex min-w-[240px] flex-1 flex-col gap-2">
                  <h2 className="m-0 text-[18px] leading-[1.4] font-semibold">
                    {problemLabel(p)}
                  </h2>
                  <span className="text-[12px] font-medium text-(--text-tertiary)">
                    {p.paragraphCount}段落 · {p.sentenceCount}文
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {(["teacher", "student"] as const).map((r) => {
                      const on = doneBy(r);
                      const Icon = on ? SquareCheckBig : Square;
                      return (
                        <span
                          key={r}
                          className="mr-3 flex items-center gap-1.5 text-[14px] text-(--text-secondary)"
                        >
                          <Icon
                            size={22}
                            aria-hidden
                            className={
                              on ? "text-(--sky-600)" : "text-(--ink-300)"
                            }
                          />
                          {ROLE_LABEL[r]}
                          <span className="sr-only">
                            {on ? "解答済み" : "未解答"}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
                {role === "teacher" && (
                  <Link
                    href={`/admin/problems/${p.id}`}
                    className="inline-flex h-[52px] items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold text-(--text-secondary) hover:bg-(--surface-chip) hover:no-underline"
                  >
                    <Pencil size={18} aria-hidden />
                    編集
                  </Link>
                )}
                {role === "teacher" && (
                  <Link
                    href={`/admin/problems/${p.id}/blessing`}
                    className="inline-flex h-[52px] items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold text-(--text-secondary) hover:bg-(--surface-chip) hover:no-underline"
                  >
                    <ShieldCheck size={18} aria-hidden />
                    加護
                    {p.blessingEnabled && (
                      <Badge tone="violet" size="sm">
                        オン
                      </Badge>
                    )}
                  </Link>
                )}
                <Link
                  href={`/compare?problem=${p.id}`}
                  className="pressable inline-flex h-[52px] items-center gap-1.5 rounded-full border-[1.5px] border-(--border-subtle) bg-(--surface-card) px-6 text-[17px] font-semibold text-(--text-secondary) hover:bg-(--surface-sunken) hover:no-underline"
                >
                  <ChartNoAxesGantt size={20} aria-hidden />
                  比較する
                </Link>
                <StartButton
                  problemId={p.id}
                  disabled={p.sentenceCount === 0}
                />
              </div>

              {p.attempts.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-[14px] font-semibold text-(--text-secondary) select-none">
                    取り組み履歴（{p.attempts.length}件）
                  </summary>
                  <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                    {p.attempts.map((a) => {
                      const tl = buildTimeline(
                        a.events.filter((e) => !e.voided),
                      );
                      return (
                        <li
                          key={a.id}
                          className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 rounded-(--radius-12) px-3 py-1 hover:bg-(--surface-sunken)"
                        >
                          <span className="min-w-[110px] text-[15px] font-semibold">
                            {attemptLabel(a)}
                          </span>
                          <span className="text-[12px] font-medium text-(--text-tertiary)">
                            {formatDate(a.startedAt)}
                          </span>
                          <span
                            className={`text-[13px] tabular-nums ${a.status === "done" ? "text-(--text-secondary)" : "text-(--amber-700)"}`}
                          >
                            {a.status === "done"
                              ? `合計 ${formatClock(tl.total)}`
                              : a.status === "in_progress"
                                ? "中断中"
                                : "未完了"}
                          </span>
                          <span className="ml-auto flex items-center gap-1">
                            {a.status === "in_progress" && a.role === role && (
                              <ResumeLink attemptId={a.id} />
                            )}
                            {role === "teacher" && (
                              <DeleteAttemptButton
                                attemptId={a.id}
                                label={attemptLabel(a)}
                              />
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </section>
          );
        })}
      </main>
    </div>
  );
}
