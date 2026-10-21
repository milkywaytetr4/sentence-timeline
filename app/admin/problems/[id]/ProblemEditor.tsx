"use client";

import {
  ChevronLeft,
  Lock,
  Merge,
  Pilcrow,
  Save,
  Split,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Badge, Button, TopBar } from "@/components/ui";
import {
  type EditParagraph,
  fromSentences,
  joinWithPreviousParagraph,
  mergeWithPrevious,
  removeRow,
  splitAt,
  startParagraphAt,
  updateText,
} from "@/lib/domain/editing";
import { detectSplitWarning, splitWarningMessage } from "@/lib/domain/text";
import type { Problem, Sentence } from "@/lib/domain/types";
import { saveProblem } from "./actions";

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

export function ProblemEditor({
  problem,
  sentences,
  locked,
}: {
  problem: Problem;
  sentences: Sentence[];
  locked: boolean;
}) {
  const [paras, setParas] = useState<EditParagraph[]>(() =>
    fromSentences(sentences, newKey),
  );
  const [title, setTitle] = useState(problem.title);
  const [year, setYear] = useState(problem.year);
  const [questionNo, setQuestionNo] = useState(problem.questionNo);
  const [instruction, setInstruction] = useState(problem.instruction);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const textareas = useRef(new Map<string, HTMLTextAreaElement>());

  const change = (next: EditParagraph[]) => {
    setParas(next);
    setDirty(true);
    setMessage(null);
  };

  const split = (pi: number, si: number, key: string) => {
    // ボタンを押すとテキスト欄からフォーカスが外れるが、カーソル位置は要素に残っている
    const pos = textareas.current.get(key)?.selectionStart ?? 0;
    const next = splitAt(paras, pi, si, pos, newKey);
    if (!next) {
      setMessage({
        tone: "error",
        text: "分けたい位置（文の途中）にカーソルを置いてから「分割」を押してください。",
      });
      return;
    }
    change(next);
  };

  const save = () => {
    startTransition(async () => {
      const res = await saveProblem({
        problemId: problem.id,
        title,
        year,
        questionNo,
        instruction,
        paragraphs: paras.map((p) => ({
          sentences: p.rows.map((r) => ({ id: r.id, text: r.text })),
        })),
      });
      if (res.ok) {
        setParas(fromSentences(res.sentences, newKey));
        setDirty(false);
        setMessage({ tone: "ok", text: "保存しました。" });
      } else {
        setMessage({ tone: "error", text: res.error });
      }
    });
  };

  const flat = paras.flatMap((p) => p.rows);
  const totalSentences = flat.length;

  return (
    <div className="dot-bg flex h-dvh flex-col">
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
          問題の編集 · {problem.title}
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

      <main className="min-h-0 flex-1 overflow-auto p-3 sm:p-6">
        <div className="mx-auto flex max-w-[1000px] flex-col gap-4">
          {message && (
            <p
              role="alert"
              className={`m-0 text-[14px] sm:hidden ${message.tone === "ok" ? "text-(--mint-700)" : "text-(--red-500)"}`}
            >
              {message.text}
            </p>
          )}

          <div className="frame grid grid-cols-2 gap-3.5 p-5 sm:grid-cols-[130px_130px_minmax(0,1fr)]">
            <label className="flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary)">
              年度
              <input
                className="field"
                value={year}
                onChange={(e) => {
                  setYear(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary)">
              大問
              <input
                className="field"
                value={questionNo}
                onChange={(e) => {
                  setQuestionNo(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary) sm:col-span-1">
              タイトル
              <input
                className="field"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary) sm:col-span-3">
              設問文
              <textarea
                className="field h-auto! resize-y py-2.5! leading-[1.7]"
                rows={2}
                value={instruction}
                onChange={(e) => {
                  setInstruction(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
          </div>

          {locked ? (
            <div className="flex items-start gap-2 px-2 text-[14px] text-(--text-secondary)">
              <Lock size={18} aria-hidden className="mt-0.5 flex-none" />
              取り組みの記録があるため、文の結合・分割と段落の変更はできません。誤字の修正とメタ情報の編集だけができます。
            </div>
          ) : (
            <div className="px-2 text-[14px] text-(--text-secondary)">
              {paras.length}段落 · {totalSentences}
              文。分割は、分けたい位置にカーソルを置いてから押します。
            </div>
          )}

          <div className="frame flex flex-col gap-2 px-3 pt-3 pb-6 sm:px-6">
            {paras.map((p, pi) => (
              <section key={p.key} className="flex flex-col gap-2">
                <div className="mt-3 flex items-center gap-3 pb-1">
                  <h2 className="m-0 text-[14px] font-semibold whitespace-nowrap">
                    第{pi + 1}段落
                  </h2>
                  <span className="h-[1.5px] flex-1 bg-(--border-subtle)" />
                  {!locked && pi > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        change(joinWithPreviousParagraph(paras, pi))
                      }
                      className="text-[12px] font-medium whitespace-nowrap text-(--text-link)"
                    >
                      前の段落とつなぐ
                    </button>
                  )}
                </div>
                {p.rows.map((r, si) => {
                  const nextText =
                    p.rows[si + 1]?.text ??
                    paras[pi + 1]?.rows[0]?.text ??
                    null;
                  const warning = detectSplitWarning(r.text, nextText);
                  return (
                    <div
                      key={r.key}
                      className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-(--radius-16) px-3 py-2.5 lg:grid-cols-[44px_minmax(0,1fr)_auto]"
                      style={{
                        border: `1.5px solid ${warning ? "var(--amber-500)" : "var(--ink-100)"}`,
                        background: warning
                          ? "var(--amber-100)"
                          : "var(--surface-card)",
                      }}
                    >
                      <span className="pt-2.5 font-mono text-[12px] leading-none font-medium text-(--text-tertiary)">
                        {pi + 1}-{si + 1}
                      </span>
                      <div className="flex flex-col items-start gap-1.5">
                        <textarea
                          ref={(el) => {
                            if (el) textareas.current.set(r.key, el);
                            else textareas.current.delete(r.key);
                          }}
                          aria-label={`${pi + 1}段落${si + 1}文目`}
                          value={r.text}
                          onChange={(e) =>
                            change(updateText(paras, pi, si, e.target.value))
                          }
                          rows={Math.max(1, Math.ceil(r.text.length / 80))}
                          className="w-full resize-none rounded-(--radius-6) border-none bg-transparent px-1 py-1 text-[16px] leading-[1.6] outline-none [field-sizing:content] focus:bg-(--surface-card) focus:shadow-(--focus-ring)"
                        />
                        {warning && (
                          <Badge tone="amber" size="sm">
                            {splitWarningMessage(warning)}
                          </Badge>
                        )}
                      </div>
                      {!locked && (
                        <div className="col-start-2 flex flex-wrap gap-1.5 lg:col-start-3">
                          {(si > 0 || pi > 0) && (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={Merge}
                              onClick={() =>
                                change(mergeWithPrevious(paras, pi, si))
                              }
                            >
                              前の文と結合
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Split}
                            onClick={() => split(pi, si, r.key)}
                          >
                            分割
                          </Button>
                          {si > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={Pilcrow}
                              onClick={() =>
                                change(startParagraphAt(paras, pi, si, newKey))
                              }
                            >
                              ここから新しい段落
                            </Button>
                          )}
                          <button
                            type="button"
                            aria-label="この文を削除"
                            title="この文を削除"
                            onClick={() => change(removeRow(paras, pi, si))}
                            className="inline-flex size-8 items-center justify-center rounded-full text-(--text-tertiary) hover:bg-(--red-100) hover:text-(--red-500)"
                          >
                            <Trash2 size={16} aria-hidden />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
