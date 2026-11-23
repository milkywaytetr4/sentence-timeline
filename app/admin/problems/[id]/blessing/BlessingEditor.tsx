"use client";

import { ChevronLeft, Hand, Save } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { SKIM_CLASS } from "@/components/blessing";
import { Button, TopBar } from "@/components/ui";
import { blankText, layoutProblem } from "@/lib/domain/layout";
import type { Problem, Sentence } from "@/lib/domain/types";
import { saveBlessing } from "../actions";

/**
 * 加護の編集。計測画面で加護ありのときに見える本文をそのまま出し、文をタップして流し読みしてよい文を切り替える。
 * 選択肢は流し読みの対象にしないので出さない
 */
export function BlessingEditor({
  problem,
  sentences,
}: {
  problem: Problem;
  sentences: Sentence[];
}) {
  const [enabled, setEnabled] = useState(problem.blessingEnabled);
  const [skimmable, setSkimmable] = useState(
    () => new Set(sentences.filter((s) => s.skimmable).map((s) => s.id)),
  );
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const layout = useMemo(() => layoutProblem(sentences), [sentences]);

  const touch = () => {
    setDirty(true);
    setMessage(null);
  };

  const toggle = (id: string) => {
    const next = new Set(skimmable);
    if (!next.delete(id)) next.add(id);
    setSkimmable(next);
    touch();
  };

  const save = () =>
    startTransition(async () => {
      const res = await saveBlessing({
        problemId: problem.id,
        enabled,
        skimmableIds: [...skimmable],
      });
      if (res.ok) {
        setDirty(false);
        setMessage({ tone: "ok", text: "保存しました。" });
      } else {
        setMessage({ tone: "error", text: res.error });
      }
    });

  return (
    <div className="dot-bg relative flex h-dvh flex-col">
      <TopBar>
        <Link
          href="/"
          aria-label="一覧へ"
          title="一覧へ"
          onClick={(e) => {
            if (
              dirty &&
              !window.confirm(
                "保存していない変更があります。破棄して一覧へ戻りますか。",
              )
            ) {
              e.preventDefault();
            }
          }}
          className="inline-flex size-11 flex-none items-center justify-center rounded-[10px] text-(--text-tertiary) hover:bg-(--surface-chip)"
        >
          <ChevronLeft size={22} aria-hidden />
        </Link>
        <span className="min-w-0 truncate text-[18px] font-semibold">
          加護の編集 · {problem.title}
        </span>
        <div className="ml-auto flex flex-none items-center gap-3">
          {message && (
            <output
              className={`hidden text-[13px] sm:inline ${message.tone === "ok" ? "text-(--mint-700)" : "text-(--red-500)"}`}
            >
              {message.text}
            </output>
          )}
          <Button icon={Save} onClick={save} disabled={pending || !dirty}>
            {pending ? "保存しています…" : "保存する"}
          </Button>
        </div>
      </TopBar>

      <main className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto px-3 pt-6 pb-16 sm:px-6">
        {message && (
          <output
            className={`w-full max-w-[820px] text-[13px] sm:hidden ${message.tone === "ok" ? "text-(--mint-700)" : "text-(--red-500)"}`}
          >
            {message.text}
          </output>
        )}
        <div className="flex w-full max-w-[820px] flex-col gap-2 rounded-(--radius-20) border-[1.5px] border-(--border-subtle) bg-(--surface-card) px-5 py-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                touch();
              }}
              className="size-5 flex-none accent-(--sky-600)"
            />
            <span className="text-[15px] font-semibold">
              これ以降の取り組みを加護ありにする
            </span>
          </label>
          <p className="m-0 text-[13px] text-(--text-tertiary)">
            先生と生徒の両方に適用されます。始めた後の取り組みは変わりません。
          </p>
          {enabled && skimmable.size === 0 && (
            <p className="m-0 text-[13px] text-(--amber-700)">
              流し読みしてよい文がないため、加護なしとして記録されます。
            </p>
          )}
        </div>

        <div className="flex w-full max-w-[820px] items-center gap-2.5 px-2 py-1 text-[14px] text-(--text-secondary)">
          <Hand size={18} aria-hidden className="flex-none" />
          <span>流し読みしてよい文をタップしてください。</span>
          <span className="ml-auto text-[13px] whitespace-nowrap text-(--text-tertiary) tabular-nums">
            {skimmable.size}文
          </span>
        </div>

        {/* 文の見た目は計測画面（app/attempts/[id]/Recorder.tsx）に合わせる */}
        <div
          className="w-full max-w-[820px] rounded-(--radius-frame) bg-(--surface-card) py-8 pr-5 pl-11 shadow-(--shadow-2) sm:pr-10 sm:pl-16"
          style={{ border: "var(--ring-frame) solid var(--frame-ring)" }}
        >
          <div className="flex flex-col gap-5">
            {problem.instruction && (
              <p className="m-0 text-[14px] whitespace-pre-line text-(--text-tertiary)">
                {problem.instruction}
              </p>
            )}
            {layout.passage.map((para) =>
              para.number === null ? (
                <p
                  key={para.paragraphIndex}
                  className="m-0 text-center text-[18px] leading-[2.05] text-(--text-tertiary) select-none sm:text-[20px]"
                >
                  {para.rows.map((s) => blankText(s.label)).join(" ")}
                </p>
              ) : (
                <p
                  key={para.paragraphIndex}
                  className="relative m-0 text-[18px] leading-[2.05] text-pretty sm:text-[20px]"
                >
                  <span className="absolute top-1.5 -left-7 text-[12px] font-medium text-(--text-placeholder) select-none sm:-left-9">
                    {para.number}
                  </span>
                  {para.rows.map((s) =>
                    s.kind === "blank" ? (
                      <span
                        key={s.id}
                        className="mr-1 px-1 py-1.5 text-(--text-tertiary) select-none"
                      >
                        {blankText(s.label)}
                      </span>
                    ) : (
                      // biome-ignore lint/a11y/useSemanticElements: 計測画面と同じく、文中で改行を保ったまま折り返すため button にしない
                      <span
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={skimmable.has(s.id)}
                        onClick={() => toggle(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle(s.id);
                          }
                        }}
                        className={`mr-1 cursor-pointer rounded-(--radius-6) px-1 py-1.5 [box-decoration-break:clone] transition-[background,color] duration-(--dur-fast) outline-none hover:bg-(--surface-sunken) focus-visible:outline-2 focus-visible:outline-(--sky-400) ${skimmable.has(s.id) ? SKIM_CLASS : ""}`}
                      >
                        {s.text}
                      </span>
                    ),
                  )}
                </p>
              ),
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
