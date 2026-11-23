"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ClipboardPaste,
  Lock,
  Merge,
  Pilcrow,
  Plus,
  Save,
  Split,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  IconButton,
  TopBar,
} from "@/components/ui";
import {
  appendParagraphs,
  type EditParagraph,
  fromSentences,
  joinWithPreviousParagraph,
  mergeWithPrevious,
  removeRow,
  splitAt,
  startParagraphAt,
  updateLabel,
  updateText,
} from "@/lib/domain/editing";
import { blankText, choiceName } from "@/lib/domain/layout";
import { parsePassageText } from "@/lib/domain/passage";
import { splitWords } from "@/lib/domain/question";
import { detectSplitWarning, splitWarningMessage } from "@/lib/domain/text";
import {
  PROBLEM_KIND_LABEL,
  type Problem,
  QUESTION_KIND_LABEL,
  type Question,
  type QuestionKind,
  type Sentence,
} from "@/lib/domain/types";
import { deleteProblem, saveProblem } from "./actions";

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

/** 語群は空白区切りの1行で編集し、保存するときに1語ずつに分ける */
type EditQuestion = {
  key: string;
  kind: QuestionKind;
  label: string;
  instruction: string;
  words: string;
};

const toEditQuestions = (questions: readonly Question[]): EditQuestion[] =>
  questions.map((q) => ({
    key: newKey(),
    kind: q.kind,
    label: q.label,
    instruction: q.instruction,
    words: q.kind === "word_order" ? q.words.join(" ") : "",
  }));

const fromEditQuestion = ({
  kind,
  label,
  instruction,
  words,
}: EditQuestion): Question =>
  kind === "word_order"
    ? { kind, label, instruction, words: splitWords(words) }
    : { kind, label, instruction };

export function ProblemEditor({
  problem,
  sentences,
  questions: initialQuestions,
  locked,
  truncated,
}: {
  problem: Problem;
  sentences: Sentence[];
  questions: Question[];
  locked: boolean;
  /** 抽出がコンテンツフィルターで打ち切られ、途中までしか取り込めていない */
  truncated: boolean;
}) {
  const [paras, setParas] = useState<EditParagraph[]>(() =>
    fromSentences(sentences, newKey),
  );
  const [title, setTitle] = useState(problem.title);
  const [year, setYear] = useState(problem.year);
  const [questionNo, setQuestionNo] = useState(problem.questionNo);
  const [instruction, setInstruction] = useState(problem.instruction);
  const [questions, setQuestions] = useState(() =>
    toEditQuestions(initialQuestions),
  );
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const [pasted, setPasted] = useState("");
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDeleting] = useTransition();
  const textareas = useRef(new Map<string, HTMLTextAreaElement>());

  const change = (next: EditParagraph[]) => {
    setParas(next);
    setDirty(true);
    setMessage(null);
  };

  const changeQuestions = (next: EditQuestion[]) => {
    setQuestions(next);
    setDirty(true);
    setMessage(null);
  };

  const updateQuestion = (i: number, patch: Partial<EditQuestion>) =>
    changeQuestions(
      questions.map((q, j) => (j === i ? { ...q, ...patch } : q)),
    );

  const moveQuestion = (i: number, by: -1 | 1) => {
    const next = [...questions];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    changeQuestions(next);
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

  const append = () => {
    const added = parsePassageText(pasted, problem.kind);
    if (added.length === 0) {
      setMessage({ tone: "error", text: "追加する本文を貼り付けてください。" });
      return;
    }
    change(appendParagraphs(paras, added, problem.kind, newKey));
    setPasted("");
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
          sentences: p.rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            label: r.label,
            text: r.text,
          })),
        })),
        questions: questions.map(fromEditQuestion),
      });
      if (res.ok) {
        setParas(fromSentences(res.sentences, newKey));
        setQuestions(toEditQuestions(res.questions));
        setDirty(false);
        setMessage({ tone: "ok", text: "保存しました。" });
      } else {
        setMessage({ tone: "error", text: res.error });
      }
    });
  };

  const remove = () => {
    startDeleting(async () => {
      const res = await deleteProblem(problem.id);
      if (res.ok) {
        router.push("/");
        return;
      }
      setConfirmDelete(false);
      setMessage({ tone: "error", text: res.error });
    });
  };

  const bodyRows = paras.flatMap((p) =>
    p.rows.filter((r) => r.kind === "sentence"),
  );
  const totalSentences = bodyRows.length;
  const bodyParagraphs = paras.filter((p) =>
    p.rows.some((r) => r.kind === "sentence"),
  ).length;
  // 見出しの段落番号は、空所だけの段落と選択肢を飛ばして本文の段落だけで振る
  let paragraphNo = 0;
  const headings = paras.map((p) => {
    const first = p.rows[0];
    if (first?.kind === "choice") return choiceName(first);
    if (p.rows.every((r) => r.kind === "blank")) return "空所";
    paragraphNo += 1;
    return `第${paragraphNo}段落`;
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
          <IconButton
            icon={Trash2}
            label="この問題を削除"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
          />
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
            <div className="col-span-2 flex items-center gap-2 text-[12px] font-medium text-(--text-secondary) sm:col-span-3">
              種類
              <Badge tone="neutral" size="sm">
                {PROBLEM_KIND_LABEL[problem.kind]}
              </Badge>
            </div>
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

          {truncated && (
            <p
              role="note"
              className="m-0 rounded-(--radius-16) border-[1.5px] border-(--amber-500) bg-(--amber-100) px-4 py-3 text-[14px] leading-[1.7]"
            >
              LLM
              の安全フィルターで抽出が途中で止められたため、読み取れたところまでを取り込みました。
              最後の文が途中で切れていないかを確かめ、残りの本文と選択肢を下の「本文を貼り付けて追加」から足してください。
            </p>
          )}

          {locked ? (
            <div className="flex items-start gap-2 px-2 text-[14px] text-(--text-secondary)">
              <Lock size={18} aria-hidden className="mt-0.5 flex-none" />
              取り組みの記録があるため、文の結合・分割と段落の変更はできません。誤字の修正とメタ情報の編集だけができます。
            </div>
          ) : (
            <div className="px-2 text-[14px] text-(--text-secondary)">
              {bodyParagraphs}段落 · {totalSentences}文
            </div>
          )}

          <div className="frame flex flex-col gap-2 px-3 pt-3 pb-6 sm:px-6">
            {paras.map((p, pi) => (
              <section key={p.key} className="flex flex-col gap-2">
                <div className="mt-3 flex items-center gap-3 pb-1">
                  <h2 className="m-0 text-[14px] font-semibold whitespace-nowrap">
                    {headings[pi]}
                  </h2>
                  <span className="h-[1.5px] flex-1 bg-(--border-subtle)" />
                  {!locked &&
                    pi > 0 &&
                    [p, paras[pi - 1]].every((q) =>
                      q.rows.every((r) => r.kind !== "choice"),
                    ) && (
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
                  const warning =
                    r.kind === "sentence"
                      ? detectSplitWarning(r.text, nextText)
                      : null;
                  const prevRow =
                    si > 0 ? p.rows[si - 1] : paras[pi - 1]?.rows.at(-1);
                  const labelInput = (
                    <label className="flex items-center gap-1.5 text-[12px] font-medium text-(--text-secondary)">
                      {r.kind === "blank" ? "空所の番号" : "記号"}
                      <input
                        className="field h-8! w-16 px-2!"
                        value={r.label ?? ""}
                        onChange={(e) =>
                          change(updateLabel(paras, pi, si, e.target.value))
                        }
                      />
                    </label>
                  );
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
                        {r.kind === "blank" ? (
                          <div className="flex items-center gap-3 py-1">
                            <span className="text-[16px] text-(--text-tertiary)">
                              {blankText(r.label)}
                            </span>
                            {labelInput}
                          </div>
                        ) : (
                          <>
                            {r.kind === "choice" &&
                              r.label !== null &&
                              labelInput}
                            <textarea
                              ref={(el) => {
                                if (el) textareas.current.set(r.key, el);
                                else textareas.current.delete(r.key);
                              }}
                              aria-label={`${pi + 1}段落${si + 1}文目`}
                              value={r.text}
                              onChange={(e) =>
                                change(
                                  updateText(paras, pi, si, e.target.value),
                                )
                              }
                              rows={Math.max(1, Math.ceil(r.text.length / 80))}
                              className="w-full resize-none rounded-(--radius-6) border-none bg-transparent px-1 py-1 text-[16px] leading-[1.6] outline-none [field-sizing:content] focus:bg-(--surface-card) focus:shadow-(--focus-ring)"
                            />
                          </>
                        )}
                        {warning && (
                          <Badge tone="amber" size="sm">
                            {splitWarningMessage(warning)}
                          </Badge>
                        )}
                      </div>
                      {!locked && (
                        <div className="col-start-2 flex flex-wrap gap-1.5 lg:col-start-3">
                          {r.kind === "sentence" &&
                            prevRow?.kind === "sentence" && (
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
                          {r.kind === "sentence" && (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={Split}
                              onClick={() => split(pi, si, r.key)}
                            >
                              分割
                            </Button>
                          )}
                          {r.kind !== "choice" && si > 0 && (
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
                            aria-label="この行を削除"
                            title="この行を削除"
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

          {!locked && (
            <div className="frame flex flex-col gap-3 p-5">
              <label className="flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary)">
                本文を貼り付けて追加
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={6}
                  placeholder={
                    problem.kind === "summary"
                      ? "段落の間は空行で区切ります。"
                      : "段落の間は空行で区切ります。\n空所は ( 1 ) のように番号を括弧で囲み、選択肢は a) のように記号で始めます。"
                  }
                  className="field h-auto! resize-y py-2.5! text-[15px] leading-[1.7]"
                />
              </label>
              <Button
                variant="secondary"
                icon={ClipboardPaste}
                onClick={append}
                disabled={!pasted.trim()}
                className="self-start"
              >
                末尾に追加
              </Button>
            </div>
          )}

          {problem.kind !== "summary" && (
            <div className="frame flex flex-col gap-3 px-3 pt-4 pb-5 sm:px-6">
              <div className="flex items-center gap-3">
                <h2 className="m-0 text-[14px] font-semibold whitespace-nowrap">
                  小問
                </h2>
                <span className="h-[1.5px] flex-1 bg-(--border-subtle)" />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Plus}
                  onClick={() =>
                    changeQuestions([
                      ...questions,
                      {
                        key: newKey(),
                        kind: "word_order",
                        label: "",
                        instruction: "",
                        words: "",
                      },
                    ])
                  }
                >
                  並べ替えを追加
                </Button>
              </div>
              {questions.map((q, i) => (
                <div
                  key={q.key}
                  className="flex flex-col gap-2.5 rounded-(--radius-16) border-[1.5px] border-(--ink-100) bg-(--surface-card) px-3 py-3"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge tone="neutral" size="sm">
                      {QUESTION_KIND_LABEL[q.kind]}
                    </Badge>
                    <label className="flex items-center gap-1.5 text-[12px] font-medium text-(--text-secondary)">
                      記号
                      <input
                        className="field h-8! w-16 px-2!"
                        value={q.label}
                        onChange={(e) =>
                          updateQuestion(i, { label: e.target.value })
                        }
                      />
                    </label>
                    <div className="ml-auto flex gap-1">
                      <IconButton
                        icon={ArrowUp}
                        label="上へ"
                        disabled={i === 0}
                        onClick={() => moveQuestion(i, -1)}
                      />
                      <IconButton
                        icon={ArrowDown}
                        label="下へ"
                        disabled={i === questions.length - 1}
                        onClick={() => moveQuestion(i, 1)}
                      />
                      {/* 挿入の小問は選択肢の設問文の置き場なので、挿入問題から外せないようにする */}
                      {q.kind !== "insertion" && (
                        <IconButton
                          icon={Trash2}
                          label="この小問を削除"
                          onClick={() =>
                            changeQuestions(questions.filter((_, j) => j !== i))
                          }
                        />
                      )}
                    </div>
                  </div>
                  <label className="flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary)">
                    設問文
                    <textarea
                      className="field h-auto! resize-y py-2.5! leading-[1.7]"
                      rows={2}
                      value={q.instruction}
                      placeholder={
                        q.kind === "insertion"
                          ? "選択肢の直前に印刷されている設問文。本文の前の設問文にまとめて書かれているときは空のままにします。"
                          : undefined
                      }
                      onChange={(e) =>
                        updateQuestion(i, { instruction: e.target.value })
                      }
                    />
                  </label>
                  {q.kind === "word_order" && (
                    <label className="flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary)">
                      語群（空白区切り）
                      <input
                        className="field"
                        value={q.words}
                        onChange={(e) =>
                          updateQuestion(i, { words: e.target.value })
                        }
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {confirmDelete && (
        <ConfirmDialog
          icon={Trash2}
          iconColor="var(--red-500)"
          title="問題を削除しますか"
          body={
            locked
              ? "この問題の取り組みの記録もすべて削除されます。元に戻せません。"
              : "元に戻せません。"
          }
          okLabel={deleting ? "削除しています…" : "削除する"}
          okVariant="danger"
          okDisabled={deleting}
          onOk={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
