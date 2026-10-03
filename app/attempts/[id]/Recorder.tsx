"use client";

import {
  ArrowRight,
  BookCheck,
  Check,
  ChevronLeft,
  CircleCheckBig,
  CirclePause,
  CloudOff,
  Eye,
  Hand,
  Pause,
  PencilLine,
  Play,
  Timer,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useToast } from "@/components/Toast";
import { Badge, Button, ConfirmDialog, IconButton } from "@/components/ui";
import { loadQueue, useEventSync } from "@/lib/client/useEventSync";
import { countChars } from "@/lib/domain/text";
import {
  buildTimeline,
  deriveState,
  elapsedSeconds,
  formatClock,
  UNDOABLE_TYPES,
} from "@/lib/domain/timeline";
import type {
  EventType,
  Sentence,
  StoredEvent,
  TimelineEvent,
} from "@/lib/domain/types";
import { ANSWER_MAX_LENGTH } from "@/lib/domain/wire";

type Mode = "waiting" | "reading" | "answer" | "review" | "paused" | "done";

const MODE_LABEL: Record<Mode, string> = {
  waiting: "開始前",
  reading: "読解中",
  answer: "答案作成中",
  review: "見返し中",
  paused: "一時停止中",
  done: "解答完了",
};

const MODE_BADGE = {
  waiting: "neutral",
  reading: "sky",
  answer: "neutral",
  review: "sky",
  paused: "neutral",
  done: "mint",
} as const;

/** 答案作成中は背景の彩度を落とし、見返し中は色を戻す（Design v3） */
const MODE_BG: Record<Mode, [string, string]> = {
  waiting: ["var(--ink-200)", "var(--ink-400)"],
  reading: ["var(--sky-100)", "var(--sky-400)"],
  answer: ["var(--ink-100)", "var(--ink-300)"],
  review: ["var(--sky-100)", "var(--sky-400)"],
  paused: ["var(--ink-200)", "var(--ink-400)"],
  done: ["var(--sky-100)", "var(--sky-400)"],
};

type Props = {
  attemptId: string;
  problemId: string;
  title: string;
  attemptName: string;
  sentences: Sentence[];
  initialEvents: StoredEvent[];
  initialAnswer: string | null;
};

export function Recorder({
  attemptId,
  problemId,
  title,
  attemptName,
  sentences,
  initialEvents,
  initialAnswer,
}: Props) {
  const router = useRouter();
  const showToast = useToast();
  const { enqueue, flush, pendingCount, status } = useEventSync(attemptId);

  const [events, setEvents] = useState<TimelineEvent[]>(() =>
    initialEvents.filter((e) => !e.voided),
  );
  const nextSeq = useRef(Math.max(0, ...initialEvents.map((e) => e.seq)) + 1);
  /** 直前のタップ。Undo は1回だけなので、取り消したら null に戻す */
  const [undoTarget, setUndoTarget] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"readDone" | "finish" | null>(null);
  const [showTimer, setShowTimer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** ダイアログを閉じても、解答完了を取り消して戻っても、書きかけの解答を残す */
  const [answer, setAnswer] = useState(initialAnswer ?? "");
  const [now, setNow] = useState(() => Date.now());

  // サーバーにまだ届いていない記録（前回の通信断の分）を画面の状態に反映する。
  // localStorage はサーバー描画時に読めないので、マウント後に合わせる
  useEffect(() => {
    const pending = loadQueue(attemptId);
    if (pending.length === 0) return;
    const voided = new Set(
      pending.flatMap((op) => (op.op === "void" ? [op.eventId] : [])),
    );
    setEvents((prev) => {
      const known = new Set(prev.map((e) => e.id));
      const added: TimelineEvent[] = pending.flatMap((op) =>
        op.op === "event" && !known.has(op.event.id)
          ? [
              {
                id: op.event.id,
                seq: op.event.seq,
                type: op.event.type,
                sentenceId: op.event.sentenceId,
                clientTs: Date.parse(op.event.clientTs),
              },
            ]
          : [],
      );
      for (const e of added)
        nextSeq.current = Math.max(nextSeq.current, e.seq + 1);
      return [...prev, ...added].filter((e) => !voided.has(e.id));
    });
  }, [attemptId]);

  const state = useMemo(() => deriveState(events), [events]);
  const mode: Mode =
    state.phase === "done"
      ? "done"
      : state.waiting
        ? "waiting"
        : state.paused
          ? "paused"
          : state.phase === "reading"
            ? "reading"
            : state.focusedId
              ? "review"
              : "answer";

  useEffect(() => {
    if (!showTimer && mode !== "done") return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [showTimer, mode]);

  const record = (
    type: Exclude<EventType, "start">,
    sentenceId: string | null = null,
  ) => {
    const ts = Date.now();
    const ev: TimelineEvent = {
      id: crypto.randomUUID(),
      seq: nextSeq.current++,
      type,
      sentenceId,
      clientTs: ts,
    };
    setEvents((prev) => [...prev, ev]);
    if (UNDOABLE_TYPES.has(type)) setUndoTarget(ev.id);
    enqueue({
      op: "event",
      event: { ...ev, type, clientTs: new Date(ts).toISOString() },
    });
    return ev;
  };

  const undo = () => {
    if (!undoTarget || mode === "paused" || mode === "waiting") return;
    const target = undoTarget;
    setEvents((prev) => prev.filter((e) => e.id !== target));
    setUndoTarget(null);
    enqueue({ op: "void", eventId: target });
  };

  const tapSentence = (id: string) => {
    if (mode === "paused" || mode === "waiting" || mode === "done") return;
    if (mode === "reading") {
      if (state.focusedId !== id) record("focus", id);
      return;
    }
    // 答案作成中: タップで見返し開始、同じ文の再タップで見返し終了
    if (state.focusedId === id) record("unfocus");
    else record("focus", id);
  };

  const tapBackground = () => {
    if (mode === "review") record("unfocus");
  };

  const submit = async () => {
    setSubmitting(true);
    enqueue({ op: "answer", text: answer.trim() });
    const finishEvent = record("finish");
    const result = await flush();
    if (result === "synced") {
      const total = buildTimeline([...events, finishEvent]).total;
      showToast({
        tone: "success",
        title: "記録を保存しました",
        body: `${attemptName} · 合計 ${formatClock(total)}`,
        action: {
          href: `/compare?problem=${problemId}&a=${attemptId}`,
          label: "比較画面で見る",
        },
      });
    } else {
      showToast({
        tone: "error",
        title:
          result === "unauthorized"
            ? "入場し直してください"
            : "記録を保存できませんでした",
        body:
          result === "unauthorized"
            ? "記録は端末に残っています。入場し直したあと一覧を開くと送信します。"
            : "記録は端末に残っています。次に一覧を開いたときに送り直します。",
      });
    }
    router.push("/");
  };

  const goBack = () => {
    // 一覧に戻っている間の時間を文に加算しないよう、計測中なら一時停止してから離れる
    if (mode !== "paused" && mode !== "waiting" && mode !== "done")
      record("pause");
    router.push("/");
  };

  const paragraphs = useMemo(() => {
    const map = new Map<number, Sentence[]>();
    for (const s of sentences) {
      const list = map.get(s.paragraphIndex) ?? [];
      list.push(s);
      map.set(s.paragraphIndex, list);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [sentences]);

  const elapsed = elapsedSeconds(events, now);
  const total = useMemo(() => buildTimeline(events).total, [events]);

  const note =
    mode === "answer"
      ? {
          icon: PencilLine,
          text: "紙に答案を書いています。見返すときは文をタップします。",
        }
      : mode === "review"
        ? {
            icon: Eye,
            text: "見返し中。同じ文か、文以外の場所をタップすると答案作成に戻ります。",
          }
        : mode === "reading" && !state.focusedId
          ? {
              icon: Hand,
              text: "読み始める文をタップしてください。計測は文ごとに行います。",
            }
          : null;

  const [bg, dot] = MODE_BG[mode];
  const ringColor =
    mode === "answer" || mode === "paused" || mode === "waiting"
      ? "var(--ink-200)"
      : "var(--frame-ring)";

  return (
    <div
      className="dot-bg relative flex h-dvh flex-col overflow-hidden"
      style={{ "--dot-bg": bg, "--dot-fg": dot } as CSSProperties}
    >
      <header className="flex h-16 flex-none items-center gap-3 border-b-[1.5px] border-(--border-subtle) bg-(--surface-card) px-3 sm:gap-3.5 sm:px-6">
        <IconButton icon={ChevronLeft} label="一覧へ" onClick={goBack} />
        <span className="min-w-0 truncate text-[14px] font-semibold">
          {title}
        </span>
        <div className="ml-auto flex flex-none items-center gap-2.5">
          <Badge tone={MODE_BADGE[mode]}>{MODE_LABEL[mode]}</Badge>
          <Button
            variant="secondary"
            icon={Timer}
            onClick={() => setShowTimer((v) => !v)}
            aria-pressed={showTimer}
            className="min-w-[120px] tabular-nums"
          >
            {showTimer ? formatClock(elapsed) : "経過時間"}
          </Button>
        </div>
      </header>

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 背景タップは文タップの補助操作で、同じ操作は「答案に戻る」ボタンでもできる */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 同上 */}
      <div
        onClick={tapBackground}
        className={`flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto px-3 pt-6 pb-7 sm:px-6 ${mode === "review" ? "cursor-pointer" : ""}`}
      >
        {note && (
          <div className="flex w-full max-w-[820px] items-center gap-2.5 px-2 py-1 text-[14px] text-(--text-secondary)">
            <note.icon size={18} aria-hidden className="flex-none" />
            <span>{note.text}</span>
          </div>
        )}
        <div
          className="w-full max-w-[820px] rounded-(--radius-frame) bg-(--surface-card) py-8 pr-5 pl-11 shadow-(--shadow-2) transition-[border-color] duration-(--dur-base) sm:pr-10 sm:pl-16"
          style={{ border: `var(--ring-frame) solid ${ringColor}` }}
        >
          <div
            className="flex flex-col gap-5 transition-[filter,opacity] duration-(--dur-base)"
            style={
              mode === "paused" || mode === "waiting"
                ? { filter: "blur(7px)", opacity: 0.35, pointerEvents: "none" }
                : undefined
            }
            aria-hidden={mode === "paused" || mode === "waiting"}
          >
            <p className="m-0 text-[14px] text-(--text-tertiary)">
              次の英文の要旨を、70〜80字の日本語でまとめよ。
            </p>
            {paragraphs.map(([pIndex, list]) => (
              <p
                key={pIndex}
                className="relative m-0 text-[18px] leading-[2.05] text-pretty sm:text-[20px]"
              >
                <span className="absolute top-1.5 -left-7 text-[12px] font-medium text-(--text-placeholder) select-none sm:-left-9">
                  {pIndex + 1}
                </span>
                {list.map((s) => {
                  const isCur = s.id === state.focusedId;
                  let style: CSSProperties | undefined;
                  if (state.phase === "reading" && isCur) {
                    style = {
                      background: "var(--sky-300)",
                      boxShadow: "0 0 0 2px var(--sky-500)",
                    };
                  } else if (
                    state.phase === "reading" &&
                    state.visited.has(s.id)
                  ) {
                    style = { background: "var(--sky-50)" };
                  } else if (mode === "review" && isCur) {
                    style = {
                      background: "var(--sky-200)",
                      boxShadow: "0 0 0 1.5px var(--sky-400)",
                    };
                  }
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: 文中で改行を保ったまま折り返すため button ではなく span にする
                    <span
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isCur}
                      onClick={(e) => {
                        e.stopPropagation();
                        tapSentence(s.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          tapSentence(s.id);
                        }
                      }}
                      className="mr-1 cursor-pointer rounded-(--radius-6) px-1 py-1.5 [box-decoration-break:clone] transition-[background] duration-(--dur-fast) outline-none focus-visible:outline-2 focus-visible:outline-(--sky-400)"
                      style={style}
                    >
                      {s.text}
                    </span>
                  );
                })}
              </p>
            ))}
          </div>
        </div>
      </div>

      <footer className="grid h-[100px] flex-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-t-[1.5px] border-(--border-subtle) bg-(--surface-card) px-3 sm:gap-4 sm:px-6">
        <div className="flex items-center gap-3">
          <IconButton
            icon={Undo2}
            label="直前のタップを取り消す"
            variant="soft"
            size={56}
            disabled={
              !undoTarget ||
              mode === "paused" ||
              mode === "waiting" ||
              mode === "done"
            }
            onClick={undo}
          />
          {(mode === "reading" || mode === "answer" || mode === "review") && (
            <IconButton
              icon={Pause}
              label="一時停止"
              variant="soft"
              size={56}
              onClick={() => record("pause")}
            />
          )}
          {mode === "paused" && (
            <IconButton
              icon={Play}
              label="再開"
              variant="inverse"
              size={56}
              onClick={() => record("resume")}
            />
          )}
        </div>
        <div className="flex justify-center">
          {mode === "waiting" && (
            <Button size="xl" icon={Play} onClick={() => record("resume")}>
              開始する
            </Button>
          )}
          {mode === "reading" && (
            <Button
              size="xl"
              icon={BookCheck}
              onClick={() => setConfirm("readDone")}
            >
              読了
            </Button>
          )}
          {mode === "answer" && (
            <Button
              size="xl"
              variant="success"
              icon={CircleCheckBig}
              onClick={() => setConfirm("finish")}
            >
              解答完了
            </Button>
          )}
          {mode === "review" && (
            <Button
              size="xl"
              variant="secondary"
              icon={PencilLine}
              onClick={() => record("unfocus")}
            >
              答案に戻る
            </Button>
          )}
        </div>
        <SyncIndicator
          pendingCount={pendingCount}
          status={status}
          onRetry={() => void flush()}
        />
      </footer>

      {confirm && (
        <ConfirmDialog
          icon={confirm === "finish" ? CircleCheckBig : BookCheck}
          iconColor={
            confirm === "finish" ? "var(--mint-500)" : "var(--sky-600)"
          }
          title={confirm === "finish" ? "解答完了にしますか" : "読了にしますか"}
          body={
            confirm === "finish"
              ? "計測を終えて、解答と記録を保存します。"
              : "答案作成に移ります。本文はあとから見返せます。"
          }
          okLabel={confirm === "finish" ? "解答完了にする" : "読了にする"}
          okVariant={confirm === "finish" ? "success" : "primary"}
          okDisabled={confirm === "finish" && answer.trim() === ""}
          onCancel={() => setConfirm(null)}
          onOk={() => {
            setConfirm(null);
            if (confirm === "finish") void submit();
            else record("read_done");
          }}
        >
          {confirm === "finish" && (
            <label className="mt-2 flex w-full flex-col gap-1.5 text-left">
              <span className="flex items-baseline justify-between text-[14px] font-semibold">
                解答
                <span className="text-[12px] font-medium text-(--text-tertiary) tabular-nums">
                  {countChars(answer)}字
                </span>
              </span>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                maxLength={ANSWER_MAX_LENGTH}
                rows={4}
                placeholder="紙に書いた答案を書き写してください"
                // biome-ignore lint/a11y/noAutofocus: 解答を入力するために開くダイアログなので、すぐに書き始められるようにする
                autoFocus
                className="field h-auto! resize-y py-2.5! leading-[1.7]"
              />
            </label>
          )}
        </ConfirmDialog>
      )}

      {mode === "paused" && (
        <div className="pointer-events-none absolute inset-x-0 top-16 bottom-[100px] flex items-center justify-center p-4">
          <div
            className="pointer-events-auto flex flex-col items-center gap-[18px] rounded-(--radius-frame) bg-(--surface-card) px-14 py-9 shadow-(--shadow-float)"
            style={{ border: "var(--ring-frame) solid var(--ink-300)" }}
          >
            <div className="flex items-center gap-2.5 text-(--ink-800)">
              <CirclePause size={28} aria-hidden />
              <span className="text-[24px] leading-[1.4] font-bold">
                一時停止中
              </span>
            </div>
            <Button size="lg" icon={Play} onClick={() => record("resume")}>
              再開する
            </Button>
          </div>
        </div>
      )}

      {mode === "done" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-(--bg-page) p-4">
          <div className="frame flex flex-col items-center gap-3 px-8 py-10 sm:px-14">
            <div className="text-[24px] leading-[1.4] font-bold">
              {submitting || pendingCount > 0
                ? "記録を送信しています"
                : "記録を保存しました"}
            </div>
            <div className="text-[14px] text-(--text-secondary) tabular-nums">
              {attemptName} · 合計 {formatClock(total)}
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-3">
              {undoTarget && !submitting && (
                <Button
                  variant="secondary"
                  size="lg"
                  icon={Undo2}
                  onClick={undo}
                >
                  取り消して戻る
                </Button>
              )}
              <Link
                href={`/compare?problem=${problemId}&a=${attemptId}`}
                className="pressable inline-flex h-[52px] items-center gap-1.5 rounded-full bg-(--accent) px-6 text-[17px] font-semibold text-white hover:bg-(--accent-hover) hover:no-underline"
              >
                比較画面で見る
                <ArrowRight size={20} aria-hidden />
              </Link>
            </div>
            <Link href="/" className="mt-1 text-[14px]">
              一覧へ戻る
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function SyncIndicator({
  pendingCount,
  status,
  onRetry,
}: {
  pendingCount: number;
  status: ReturnType<typeof useEventSync>["status"];
  onRetry: () => void;
}) {
  if (status === "unauthorized") {
    return (
      <div className="flex justify-end text-right text-[12px] text-(--amber-700)">
        <Link href="/enter">
          入場し直してください（記録は端末に残っています）
        </Link>
      </div>
    );
  }
  if (pendingCount === 0) {
    return (
      <div className="flex items-center justify-end gap-1 text-[12px] font-medium text-(--text-tertiary)">
        <Check size={14} aria-hidden />
        保存済み
      </div>
    );
  }
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onRetry}
        className={`flex items-center gap-1 rounded-full px-2 py-1 text-right text-[12px] font-medium ${status === "retrying" ? "text-(--amber-700)" : "text-(--text-tertiary)"}`}
      >
        {status === "retrying" && <CloudOff size={14} aria-hidden />}
        未送信 {pendingCount}件{status === "retrying" ? "・再送します" : ""}
      </button>
    </div>
  );
}
