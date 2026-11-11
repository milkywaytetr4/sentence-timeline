"use client";

import {
  BookCheck,
  ChevronLeft,
  CircleCheckBig,
  CirclePause,
  CloudOff,
  Hand,
  ListChecks,
  Pause,
  PencilLine,
  Play,
  Timer,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useToast } from "@/components/Toast";
import { Badge, Button, ConfirmDialog, IconButton } from "@/components/ui";
import { loadQueue, useEventSync } from "@/lib/client/useEventSync";
import { blankText, layoutProblem } from "@/lib/domain/layout";
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
  ProblemKind,
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

/** ヘッダーの高さ（px）。h-16 と揃える */
const HEADER_HEIGHT = 64;

type Props = {
  attemptId: string;
  problemId: string;
  title: string;
  attemptName: string;
  kind: ProblemKind;
  instruction: string;
  sentences: Sentence[];
  initialEvents: StoredEvent[];
  initialAnswer: string | null;
};

export function Recorder({
  attemptId,
  problemId,
  title,
  attemptName,
  kind,
  instruction,
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
  /** ダイアログを閉じても書きかけの解答を残す */
  const [answer, setAnswer] = useState(initialAnswer ?? "");
  const [now, setNow] = useState(() => Date.now());
  const [showChoices, setShowChoices] = useState(false);
  /** 本文を下へ読み進めている間はヘッダーを隠し、上へ戻したら出す */
  const [headerShown, setHeaderShown] = useState(true);
  const lastScrollTop = useRef(0);
  // 第1問(B)は本文と選択肢を行き来しながら解くので、読了を挟まず、読解中のまま解答完了まで進める。
  // 解答の照合は対面で行うため、解答も入力させない
  const insertion = kind !== "summary";

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
  // 確認ダイアログを開いている間の一時停止は、画面上は元のモードのまま見せる
  const mode: Mode =
    state.phase === "done"
      ? "done"
      : state.waiting
        ? "waiting"
        : state.paused && !confirm
          ? "paused"
          : state.phase === "reading"
            ? "reading"
            : state.focusedId
              ? "review"
              : "answer";

  useEffect(() => {
    if (!showTimer) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [showTimer]);

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

  // 確認ダイアログを開いている間（解答の書き写しを含む）は計測に含めない
  const openConfirm = (kind: "readDone" | "finish") => {
    record("pause");
    setConfirm(kind);
  };

  const cancelConfirm = () => {
    setConfirm(null);
    record("resume");
  };

  const submit = async () => {
    if (!insertion) enqueue({ op: "answer", text: answer.trim() });
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

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    // iOS では端で跳ね返る間に scrollTop が負になるので、0 未満は先頭として扱う
    const top = Math.max(0, e.currentTarget.scrollTop);
    const delta = top - lastScrollTop.current;
    lastScrollTop.current = top;
    if (top < HEADER_HEIGHT) setHeaderShown(true);
    else if (delta > 4) setHeaderShown(false);
    else if (delta < -4) setHeaderShown(true);
  };

  const layout = useMemo(() => layoutProblem(sentences), [sentences]);

  const elapsed = elapsedSeconds(events, now);

  const note =
    mode === "answer"
      ? {
          icon: PencilLine,
          text: "見返すときは文をタップします。",
        }
      : mode === "reading" && !state.focusedId
        ? { icon: Hand, text: "読み始める文をタップしてください。" }
        : null;

  const highlight = (id: string): CSSProperties | undefined => {
    const isCur = id === state.focusedId;
    if (state.phase === "reading" && isCur) {
      return {
        background: "var(--sky-300)",
        boxShadow: "0 0 0 2px var(--sky-500)",
      };
    }
    if (state.phase === "reading" && state.visited.has(id)) {
      return { background: "var(--sky-50)" };
    }
    if (mode === "review" && isCur) {
      return {
        background: "var(--sky-200)",
        boxShadow: "0 0 0 1.5px var(--sky-400)",
      };
    }
    return undefined;
  };

  const tapHandlers = (id: string): TapHandlers => ({
    role: "button",
    tabIndex: 0,
    "aria-pressed": id === state.focusedId,
    onClick: (e) => {
      e.stopPropagation();
      tapSentence(id);
    },
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        tapSentence(id);
      }
    },
  });

  const measuring =
    mode === "reading" || mode === "answer" || mode === "review";

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
      {/* キーボード操作でヘッダー内にフォーカスが移ったときは、隠れていても出す */}
      <header
        className={`absolute inset-x-0 top-0 z-20 flex h-16 items-center gap-3 border-b-[1.5px] border-(--border-subtle) bg-(--surface-card) px-3 transition-transform duration-(--dur-base) sm:gap-3.5 sm:px-6 ${headerShown ? "" : "-translate-y-full focus-within:translate-y-0"}`}
      >
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
        onScroll={onScroll}
        className={`flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto px-3 pt-[88px] pb-32 sm:px-6 ${mode === "review" ? "cursor-pointer" : ""}`}
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
            {instruction && (
              <p className="m-0 text-[14px] whitespace-pre-line text-(--text-tertiary)">
                {instruction}
              </p>
            )}
            {layout.passage.map((para) =>
              para.number === null ? (
                // 段落挿入の空所。段落1つ分の場所を取り、段落番号は振らない
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
                      // 文中で改行を保ったまま折り返すため、button ではなく span に role="button" を付ける
                      <span
                        key={s.id}
                        {...tapHandlers(s.id)}
                        className="mr-1 cursor-pointer rounded-(--radius-6) px-1 py-1.5 [box-decoration-break:clone] transition-[background] duration-(--dur-fast) outline-none focus-visible:outline-2 focus-visible:outline-(--sky-400)"
                        style={highlight(s.id)}
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
      </div>

      {/* 帯状のフッターは本文の表示領域を削るので置かず、ボタンだけを左下と右下に浮かせる。
          本文の末尾がボタンに隠れないよう、スクロール領域の下に余白を取っている */}
      <div className="absolute bottom-6 left-3 z-20 flex items-center gap-3 sm:left-6">
        <IconButton
          icon={Undo2}
          label="直前のタップを取り消す"
          variant="soft"
          size={56}
          className="shadow-(--shadow-float)"
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
            className="shadow-(--shadow-float)"
            onClick={() => record("pause")}
          />
        )}
        {mode === "paused" && (
          <IconButton
            icon={Play}
            label="再開"
            variant="inverse"
            size={56}
            className="shadow-(--shadow-float)"
            onClick={() => record("resume")}
          />
        )}
      </div>

      <div className="absolute right-3 bottom-6 z-20 flex flex-col items-end gap-2 sm:right-6">
        <SyncIndicator
          pendingCount={pendingCount}
          status={status}
          onRetry={() => void flush()}
        />
        <div className="flex gap-3">
          {mode === "waiting" && (
            <Button
              size="lg"
              icon={Play}
              className="shadow-(--shadow-float)"
              onClick={() => record("resume")}
            >
              開始する
            </Button>
          )}
          {insertion && measuring && (
            <Button
              size="lg"
              variant="secondary"
              icon={ListChecks}
              aria-pressed={showChoices}
              className="shadow-(--shadow-float)"
              onClick={() => setShowChoices((v) => !v)}
            >
              選択肢
            </Button>
          )}
          {mode === "reading" && !insertion && (
            <Button
              size="lg"
              icon={BookCheck}
              className="shadow-(--shadow-float)"
              onClick={() => openConfirm("readDone")}
            >
              読了
            </Button>
          )}
          {(mode === "answer" || (mode === "reading" && insertion)) && (
            <Button
              size="lg"
              variant="success"
              icon={CircleCheckBig}
              onClick={() => openConfirm("finish")}
            >
              解答完了
            </Button>
          )}
          {mode === "review" && (
            <Button
              size="lg"
              variant="secondary"
              icon={PencilLine}
              className="shadow-(--shadow-float)"
              onClick={() => record("unfocus")}
            >
              答案に戻る
            </Button>
          )}
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          icon={confirm === "finish" ? CircleCheckBig : BookCheck}
          iconColor={
            confirm === "finish" ? "var(--mint-500)" : "var(--sky-600)"
          }
          title={confirm === "finish" ? "解答完了にしますか" : "読了にしますか"}
          body={
            confirm === "finish"
              ? insertion
                ? "計測を終えて、記録を保存します。"
                : "計測を終えて、解答と記録を保存します。"
              : "答案作成に移ります。本文はあとから見返せます。"
          }
          okLabel={confirm === "finish" ? "解答完了にする" : "読了にする"}
          okVariant={confirm === "finish" ? "success" : "primary"}
          okDisabled={
            confirm === "finish" && !insertion && answer.trim() === ""
          }
          onCancel={cancelConfirm}
          onOk={() => {
            setConfirm(null);
            if (confirm === "finish") void submit();
            else {
              record("read_done");
              record("resume");
            }
          }}
        >
          {confirm === "finish" && !insertion && (
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

      {insertion && showChoices && measuring && (
        <ChoicesPanel
          choices={layout.choices}
          tapHandlers={tapHandlers}
          highlight={highlight}
          headerShown={headerShown}
          onClose={() => setShowChoices(false)}
        />
      )}

      {mode === "paused" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
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
    </div>
  );
}

type TapHandlers = {
  role: "button";
  tabIndex: number;
  "aria-pressed": boolean;
  onClick: (e: ReactMouseEvent) => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
};

/**
 * 本文の右に重ねて出す選択肢の一覧。閉じても記録は変えず、次に文をタップするまで
 * 選択肢を見ていたものとして扱う（読解中に文から文へ移るときと同じ扱い）
 */
function ChoicesPanel({
  choices,
  tapHandlers,
  highlight,
  headerShown,
  onClose,
}: {
  choices: Sentence[];
  tapHandlers: (id: string) => TapHandlers;
  highlight: (id: string) => CSSProperties | undefined;
  headerShown: boolean;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="選択肢"
      className={`absolute right-0 bottom-0 z-10 flex w-full max-w-[520px] flex-col border-l-[1.5px] border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-3) transition-[top] duration-(--dur-base) ${headerShown ? "top-16" : "top-0"}`}
    >
      <div className="flex h-14 flex-none items-center gap-2 border-b-[1.5px] border-(--border-subtle) px-4">
        <ListChecks size={18} aria-hidden className="text-(--text-tertiary)" />
        <span className="text-[15px] font-semibold">選択肢</span>
        <IconButton
          icon={X}
          label="選択肢を閉じる"
          className="ml-auto"
          onClick={onClose}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 pb-28">
        {choices.length === 0 && (
          <p className="m-0 text-[14px] text-(--text-tertiary)">
            選択肢が登録されていません。
          </p>
        )}
        {choices.map((c) => (
          <div
            key={c.id}
            {...tapHandlers(c.id)}
            className="flex cursor-pointer gap-3 rounded-(--radius-12) border-[1.5px] border-(--border-subtle) px-4 py-3 text-[17px] leading-[1.9] transition-[background] duration-(--dur-fast) outline-none focus-visible:outline-2 focus-visible:outline-(--sky-400)"
            style={highlight(c.id)}
          >
            {c.label && (
              <span className="flex-none font-semibold text-(--text-secondary)">
                {c.label})
              </span>
            )}
            <span className="whitespace-pre-line">{c.text}</span>
          </div>
        ))}
      </div>
    </aside>
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
      <div className="flex justify-end rounded-full bg-(--surface-card) px-3 py-1 text-right text-[12px] text-(--amber-700) shadow-(--shadow-float)">
        <Link href="/enter">
          入場し直してください（記録は端末に残っています）
        </Link>
      </div>
    );
  }
  // 保存できている間は何も出さない。タップのたびに表示が出入りすると気が散るため
  if (pendingCount === 0) return null;
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onRetry}
        className={`flex items-center gap-1 rounded-full bg-(--surface-card) px-3 py-1 text-right shadow-(--shadow-float) text-[12px] font-medium ${status === "retrying" ? "text-(--amber-700)" : "text-(--text-tertiary)"}`}
      >
        {status === "retrying" && <CloudOff size={14} aria-hidden />}
        未送信 {pendingCount}件{status === "retrying" ? "・再送します" : ""}
      </button>
    </div>
  );
}
