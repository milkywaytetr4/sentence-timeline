"use client";

import {
  ChevronsUpDown,
  FileText,
  LoaderCircle,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { IconButton, Select, Tabs } from "@/components/ui";
import { formatDate } from "@/lib/domain/format";
import { countChars } from "@/lib/domain/text";
import {
  buildTimeline,
  formatClock,
  mergeByParagraph,
  type SegmentKind,
  type Timeline,
  wordsPerMinute,
} from "@/lib/domain/timeline";
import {
  type Attempt,
  attemptLabel,
  ROLE_LABEL,
  type Role,
  type Sentence,
  type TimelineEvent,
} from "@/lib/domain/types";
import { requestRevision } from "./actions";

type AttemptData = Attempt & { events: TimelineEvent[] };
type ViewMode = "para" | "sent";

/* 色は Design v3 の比較画面に合わせる。段落ごとの系統色、文表示では同系統の濃淡を交互に使う */
const PARA_COLORS = [
  "var(--sky-600)",
  "var(--violet-500)",
  "var(--amber-500)",
  "var(--mint-500)",
  "var(--rose-500)",
];
const SHADES = [100, 66, 40];
const WRITING_COLOR = "var(--ink-300)";
const IDLE_COLOR =
  "repeating-linear-gradient(135deg, var(--ink-200) 0 4px, var(--ink-100) 4px 8px)";
const SLOT_COLORS = [
  "var(--sky-500)",
  "var(--sky-800)",
  "var(--violet-500)",
  "var(--amber-500)",
  "var(--mint-500)",
  "var(--rose-500)",
];

const mix = (c: string, p: number) =>
  p >= 100 ? c : `color-mix(in oklch, ${c} ${p}%, white)`;
const paraColor = (p: number) => PARA_COLORS[p % PARA_COLORS.length];
const slotColor = (i: number) => SLOT_COLORS[i % SLOT_COLORS.length];

type Bar = {
  kind: SegmentKind;
  start: number;
  duration: number;
  review: boolean;
  color: string;
  title: string;
  detail: string;
};

function statusText(a: Attempt) {
  return a.status === "done" ? "完了" : "未完了";
}

function defaultSlots(
  attempts: AttemptData[],
  selected: string[],
): (string | null)[] {
  if (selected.length >= 2) return selected;
  const latest = (role: Role) => {
    const mine = attempts.filter((a) => a.role === role);
    return (
      (mine.filter((a) => a.status === "done").at(-1) ?? mine.at(-1))?.id ??
      null
    );
  };
  if (selected.length === 1) {
    const picked = attempts.find((a) => a.id === selected[0]);
    const other = picked?.role === "teacher" ? "student" : "teacher";
    return [selected[0], latest(other)];
  }
  return [latest("teacher"), latest("student")];
}

export function CompareView({
  problemId,
  problemOptions,
  sentences,
  attempts,
  initialSelected,
}: {
  problemId: string;
  problemOptions: { value: string; label: string }[];
  sentences: Sentence[];
  attempts: AttemptData[];
  initialSelected: string[];
}) {
  const router = useRouter();
  const [slots, setSlots] = useState<(string | null)[]>(() =>
    defaultSlots(attempts, initialSelected),
  );
  const [editing, setEditing] = useState<number | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [mode, setMode] = useState<ViewMode>("sent");
  const [tip, setTip] = useState<{ slot: number; index: number } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  // 選んだ版を URL に残し、再読み込みや共有で同じ比較を開けるようにする
  useEffect(() => {
    const ids = slots.filter((s): s is string => Boolean(s));
    const url = `/compare?problem=${problemId}${ids.length ? `&a=${ids.join(",")}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [slots, problemId]);

  const byId = useMemo(
    () => new Map(attempts.map((a) => [a.id, a])),
    [attempts],
  );
  const timelines = useMemo(() => {
    const m = new Map<string, Timeline>();
    for (const a of attempts) m.set(a.id, buildTimeline(a.events));
    return m;
  }, [attempts]);
  const sentenceById = useMemo(
    () => new Map(sentences.map((s) => [s.id, s])),
    [sentences],
  );
  const paragraphCount = new Set(sentences.map((s) => s.paragraphIndex)).size;

  const barsFor = (tl: Timeline): Bar[] => {
    const plain = (
      kind: SegmentKind,
      start: number,
      duration: number,
    ): Bar => ({
      kind,
      start,
      duration,
      review: false,
      color: kind === "writing" ? WRITING_COLOR : IDLE_COLOR,
      title:
        kind === "writing"
          ? "答案作成中（本文を見ていない）"
          : "最初の文を選ぶ前",
      detail: `${Math.round(duration)}秒`,
    });
    const detail = (words: number, sec: number) => {
      const wpm = wordsPerMinute(words, sec);
      return `${Math.round(sec)}秒 · ${words}語 · ${wpm === null ? "—" : `${wpm} wpm`}`;
    };

    if (mode === "sent") {
      return tl.segments.map((seg) => {
        const s = seg.sentenceId ? sentenceById.get(seg.sentenceId) : undefined;
        if (seg.kind !== "sentence" || !s)
          return plain(seg.kind, seg.start, seg.duration);
        return {
          kind: seg.kind,
          start: seg.start,
          duration: seg.duration,
          review: seg.review,
          color: mix(
            paraColor(s.paragraphIndex),
            SHADES[s.sentenceIndex % SHADES.length],
          ),
          title: `${seg.review ? "見返し · " : ""}${s.paragraphIndex + 1}段落${s.sentenceIndex + 1}文目`,
          detail: detail(s.wordCount, seg.duration),
        };
      });
    }
    return mergeByParagraph(
      tl.segments,
      (id) => sentenceById.get(id)?.paragraphIndex ?? -1,
    ).map((seg) => {
      if (seg.kind !== "sentence" || seg.paragraphIndex === null) {
        return plain(seg.kind, seg.start, seg.duration);
      }
      const words = seg.sentenceIds.reduce(
        (n, id) => n + (sentenceById.get(id)?.wordCount ?? 0),
        0,
      );
      return {
        kind: seg.kind,
        start: seg.start,
        duration: seg.duration,
        review: seg.review,
        color: mix(paraColor(seg.paragraphIndex), 80),
        title: `${seg.review ? "見返し · " : ""}第${seg.paragraphIndex + 1}段落`,
        detail: detail(words, seg.duration),
      };
    });
  };

  const used = slots.flatMap((id) =>
    id && timelines.get(id) ? [timelines.get(id) as Timeline] : [],
  );
  const maxT = Math.max(60, ...used.map((t) => Math.ceil(t.total / 60) * 60));
  const pct = (sec: number) => `${(sec / maxT) * 100}%`;
  const minutes = maxT / 60;
  const step = minutes <= 15 ? 1 : minutes <= 30 ? 2 : minutes <= 60 ? 5 : 10;
  const ticks: number[] = [];
  for (let m = 0; m <= minutes; m += step) ticks.push(m);

  const openSlot = (i: number) => {
    setTip(null);
    setFlash(null);
    setEditing((cur) => (cur === i ? null : i));
  };

  const putInSlot = (slot: number, attemptId: string) => {
    setSlots((prev) => {
      const next = [...prev];
      const other = next.indexOf(attemptId);
      // すでに別の帯に入っている版を選んだら、2つの帯の中身を入れ替える
      if (other >= 0 && other !== slot) next[other] = next[slot];
      next[slot] = attemptId;
      return next;
    });
    setEditing(null);
    setFlash(slot);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 900);
  };

  const pick = (attemptId: string) => {
    if (editing !== null) {
      putInSlot(editing, attemptId);
      return;
    }
    if (slots.includes(attemptId)) return;
    const empty = slots.indexOf(null);
    if (empty >= 0) putInSlot(empty, attemptId);
  };

  const addSlot = () => {
    setSlots((prev) => [...prev, null]);
    setEditing(slots.length);
    setTip(null);
  };

  const removeSlot = (i: number) => {
    setSlots((prev) => prev.filter((_, j) => j !== i));
    setEditing(null);
    setTip(null);
  };

  const rows = (["teacher", "student"] as const).map((role) => ({
    role,
    items: attempts.filter((a) => a.role === role),
  }));

  const legend = [
    ...Array.from({ length: paragraphCount }, (_, p) => ({
      label: `第${p + 1}段落`,
      swatches:
        mode === "para"
          ? [mix(paraColor(p), 80)]
          : SHADES.map((s) => mix(paraColor(p), s)),
    })),
    { label: "答案作成中", swatches: [WRITING_COLOR] },
    { label: "最初の文を選ぶ前", swatches: [IDLE_COLOR] },
  ];

  return (
    <main className="flex-1 p-3 sm:p-6">
      <div className="frame flex flex-col gap-7 px-4 py-6 sm:px-8 sm:py-7">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            label="問題"
            icon={FileText}
            value={problemId}
            options={problemOptions}
            onChange={(v) => router.push(`/compare?problem=${v}`)}
            style={{ maxWidth: "100%" }}
          />
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex min-h-10 flex-wrap items-center gap-2.5">
            <span className="text-[14px] font-semibold whitespace-nowrap">
              取り組み履歴
            </span>
            <span
              className={`text-[12px] font-medium ${editing !== null ? "text-(--sky-700)" : "text-(--text-tertiary)"}`}
            >
              {editing !== null
                ? "入れる版を選んでください。"
                : "帯の左の名前をタップすると、比較する版を入れ替えられます。"}
            </span>
          </div>
          {attempts.length === 0 && (
            <p className="m-0 text-[14px] text-(--text-tertiary)">
              この問題にはまだ取り組みがありません。
            </p>
          )}
          <div className="flex flex-col gap-2.5">
            {rows.map(({ role, items }) =>
              items.length === 0 ? null : (
                <div
                  key={role}
                  className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-3"
                >
                  <span className="text-[14px] font-semibold text-(--text-secondary)">
                    {ROLE_LABEL[role]}
                  </span>
                  <div className="flex flex-wrap gap-2.5">
                    {items.map((a) => {
                      const at = slots.indexOf(a.id);
                      const tl = timelines.get(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => pick(a.id)}
                          aria-pressed={at >= 0}
                          className="flex min-h-[52px] min-w-[150px] flex-col justify-center gap-px rounded-(--radius-12) bg-(--surface-card) py-1.5 pr-2.5 pl-4 text-left transition-[border-color,box-shadow] duration-(--dur-fast)"
                          style={{
                            border: `2px solid ${at >= 0 ? slotColor(at) : "var(--ink-200)"}`,
                            boxShadow:
                              editing !== null ? "var(--shadow-2)" : "none",
                          }}
                        >
                          <span className="text-[15px] leading-[1.3] font-semibold whitespace-nowrap">
                            {a.attemptNo}回目
                          </span>
                          <span className="text-[12px] font-medium whitespace-nowrap text-(--text-tertiary) tabular-nums">
                            {formatDate(a.startedAt)} ·{" "}
                            {a.status === "done" && tl
                              ? formatClock(tl.total)
                              : "未完了"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ),
            )}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-6">
          <Tabs
            items={[
              { value: "para", label: "段落" },
              { value: "sent", label: "文" },
            ]}
            value={mode}
            onChange={(v) => {
              setMode(v);
              setTip(null);
            }}
          />
          <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2">
            {legend.map((l) => (
              <span
                key={l.label}
                className="flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap text-(--text-secondary)"
              >
                <span className="flex overflow-hidden rounded-[4px]">
                  {l.swatches.map((c) => (
                    <span
                      key={c}
                      className="size-3.5"
                      style={{ background: c }}
                    />
                  ))}
                </span>
                {l.label}
              </span>
            ))}
          </div>
        </div>

        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 余白のタップで詳細表示を閉じるだけの補助操作 */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 同上 */}
        <div
          onClick={() => setTip(null)}
          className="flex flex-col gap-6 rounded-(--radius-20) bg-(--surface-sunken) px-2 pt-12 pb-4 sm:px-3.5"
        >
          {slots.map((id, si) => {
            const a = id ? byId.get(id) : undefined;
            const tl = id ? timelines.get(id) : undefined;
            const active = editing === si;
            const bars = tl ? barsFor(tl) : [];
            const tipBar = tip?.slot === si ? bars[tip.index] : undefined;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: 帯は位置そのものが識別子
                key={si}
                className="grid grid-cols-[96px_minmax(0,1fr)_64px] items-center gap-2 rounded-(--radius-20) px-2 py-3 transition-[border-color,background] duration-200 sm:grid-cols-[130px_minmax(0,1fr)_92px] sm:gap-4 sm:px-3.5"
                style={{
                  border: `2px solid ${editing !== null ? (active ? slotColor(si) : "var(--ink-200)") : "transparent"}`,
                  background:
                    editing !== null
                      ? "var(--surface-card)"
                      : flash === si
                        ? mix(slotColor(si), 16)
                        : "transparent",
                }}
              >
                <div className="flex min-h-14 items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openSlot(si);
                    }}
                    aria-expanded={active}
                    className="flex min-w-0 flex-1 items-center justify-between gap-1.5 self-stretch text-left"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className="truncate text-[15px] leading-[1.3] font-bold sm:text-[16px]"
                        style={{
                          color: a
                            ? "var(--text-primary)"
                            : "var(--text-tertiary)",
                        }}
                      >
                        {a ? attemptLabel(a) : "未選択"}
                      </span>
                      <span className="text-[12px] font-medium text-(--text-tertiary)">
                        {a ? formatDate(a.startedAt) : ""}
                      </span>
                    </span>
                    <ChevronsUpDown
                      size={16}
                      aria-hidden
                      className="flex-none"
                      style={{
                        color: active
                          ? slotColor(si)
                          : "var(--text-placeholder)",
                      }}
                    />
                  </button>
                  {slots.length > 2 && (
                    <button
                      type="button"
                      aria-label="この帯を外す"
                      title="この帯を外す"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSlot(si);
                      }}
                      className="inline-flex size-7 flex-none items-center justify-center rounded-full text-(--text-tertiary) hover:bg-(--surface-chip)"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  )}
                </div>

                <div
                  className="relative h-14 rounded-(--radius-6) bg-(--surface-card)"
                  style={{
                    outline: a ? "none" : "2px dashed var(--ink-300)",
                    outlineOffset: -2,
                  }}
                >
                  {!a && (
                    <span className="absolute inset-0 flex items-center justify-center text-[12px] font-medium text-(--text-tertiary)">
                      版を選んでください
                    </span>
                  )}
                  {ticks.map((m) => (
                    <span
                      key={m}
                      className="absolute top-0 bottom-0 w-px bg-(--ink-100)"
                      style={{ left: pct(m * 60) }}
                    />
                  ))}
                  {bars.map((b, i) => {
                    const on = tip?.slot === si && tip.index === i;
                    return (
                      <button
                        // biome-ignore lint/suspicious/noArrayIndexKey: 棒は時系列順に並ぶだけで、他に識別子がない
                        key={i}
                        type="button"
                        aria-label={`${b.title} ${b.detail}`}
                        onMouseEnter={() =>
                          editing === null && setTip({ slot: si, index: i })
                        }
                        onMouseLeave={() =>
                          setTip((t) =>
                            t?.slot === si && t.index === i ? null : t,
                          )
                        }
                        onFocus={() =>
                          editing === null && setTip({ slot: si, index: i })
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (editing === null) setTip({ slot: si, index: i });
                        }}
                        className="absolute top-0 bottom-0 cursor-pointer border-none p-0"
                        style={{
                          left: pct(b.start),
                          width: pct(b.duration),
                          background: b.color,
                          boxShadow: `inset -1px 0 0 #fff${on ? ", inset 0 0 0 2px var(--ink-900)" : ""}`,
                        }}
                      />
                    );
                  })}
                  {tl?.readDoneAt != null && (
                    <>
                      <span
                        className="pointer-events-none absolute -top-2.5 -bottom-2.5 w-0.5 bg-(--ink-900)"
                        style={{ left: pct(tl.readDoneAt) }}
                      />
                      <span
                        className="pointer-events-none absolute -top-8 -translate-x-1/2 text-[12px] leading-none font-semibold whitespace-nowrap"
                        style={{ left: pct(tl.readDoneAt) }}
                      >
                        読了 {formatClock(tl.readDoneAt)}
                      </span>
                    </>
                  )}
                  {tipBar && (
                    <div
                      className="pointer-events-none absolute bottom-[calc(100%+12px)] z-10 flex -translate-x-1/2 flex-col gap-[3px] rounded-(--radius-12) bg-(--surface-inverse) px-3.5 py-2.5 whitespace-nowrap text-white shadow-(--shadow-3)"
                      style={{
                        left: `${Math.min(Math.max(((tipBar.start + tipBar.duration / 2) / maxT) * 100, 12), 88)}%`,
                      }}
                    >
                      <span className="text-[14px] leading-[1.3] font-bold">
                        {tipBar.title}
                      </span>
                      <span className="text-[13px] leading-[1.3] text-(--ink-300) tabular-nums">
                        {tipBar.detail}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-0.5">
                  <span className="text-[18px] leading-[1.2] font-bold tabular-nums sm:text-[20px]">
                    {tl ? formatClock(tl.total) : "—"}
                  </span>
                  <span
                    className="text-[12px] font-medium"
                    style={{
                      color:
                        a && a.status !== "done"
                          ? "var(--amber-700)"
                          : "var(--text-tertiary)",
                    }}
                  >
                    {a ? statusText(a) : ""}
                  </span>
                </div>
              </div>
            );
          })}

          <div className="-mt-3.5 grid grid-cols-[96px_minmax(0,1fr)_64px] gap-2 px-2.5 sm:grid-cols-[130px_minmax(0,1fr)_92px] sm:gap-4 sm:px-4">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                addSlot();
              }}
              className="inline-flex items-center gap-1 self-start text-[12px] font-semibold text-(--text-link)"
            >
              <Plus size={14} aria-hidden />
              帯を追加
            </button>
            <div className="relative h-5">
              {ticks.map((m) => (
                <span
                  key={m}
                  className="absolute -translate-x-1/2 text-[12px] font-medium text-(--text-tertiary) tabular-nums"
                  style={{ left: pct(m * 60) }}
                >
                  {m}
                </span>
              ))}
            </div>
            <span className="text-[12px] font-medium text-(--text-tertiary)">
              分
            </span>
          </div>
        </div>

        <p className="m-0 text-[12px] font-medium text-(--text-tertiary)">
          同じ段落の色が後ろに再び現れる箇所が戻り読み、読了線より右の色付き部分が答案作成中の見返しです。一時停止中の時間は含みません。
        </p>

        <section className="flex flex-col gap-3">
          <span className="text-[14px] font-semibold">解答</span>
          <div className="grid gap-4 sm:grid-cols-2">
            {slots.map((id, si) => {
              const a = id ? byId.get(id) : undefined;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: 帯と同じく位置そのものが識別子
                <div key={si} className="flex flex-col gap-2">
                  <AnswerCard attempt={a} color={slotColor(si)} />
                  {a?.answer && (
                    <AiAnswerCard attempt={a} color={slotColor(si)} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

/** 帯と同じ順に並べ、帯の色の枠でどの版の解答かを示す */
function AnswerCard({
  attempt: a,
  color,
}: {
  attempt: Attempt | undefined;
  color: string;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-(--radius-12) bg-(--surface-card) px-4 py-3.5"
      style={{ border: `2px solid ${a ? color : "var(--ink-200)"}` }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className="text-[15px] font-bold"
          style={{
            color: a ? "var(--text-primary)" : "var(--text-tertiary)",
          }}
        >
          {a ? attemptLabel(a) : "未選択"}
        </span>
        {a?.answer && (
          <span className="text-[12px] font-medium text-(--text-tertiary) tabular-nums">
            {countChars(a.answer)}字
          </span>
        )}
      </div>
      {a?.answer ? (
        <p className="m-0 text-[16px] leading-[1.8] break-words whitespace-pre-wrap">
          {a.answer}
        </p>
      ) : (
        <p className="m-0 text-[14px] text-(--text-tertiary)">
          {a ? "解答の記録はありません。" : ""}
        </p>
      )}
    </div>
  );
}

/** 同じ帯の色の破線枠にして、上の解答を AI が改稿したものであることを示す */
function AiAnswerCard({
  attempt: a,
  color,
}: {
  attempt: Attempt;
  color: string;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const onGenerate = () => {
    startTransition(async () => {
      // 保存後の再描画で props の aiAnswer が新しくなるので、改稿はここでは受け取らない
      const res = await requestRevision(a.id);
      if (!res.ok) {
        toast({
          tone: "error",
          title: "改稿できませんでした",
          body: res.error,
        });
      }
    });
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-(--radius-12) bg-(--surface-card) px-4 py-3.5"
      style={{ border: `2px dashed ${color}` }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-bold">AI による改稿</span>
        <span className="flex items-center gap-2">
          {a.aiAnswer && (
            <span className="text-[12px] font-medium text-(--text-tertiary) tabular-nums">
              {countChars(a.aiAnswer)}字
            </span>
          )}
          <IconButton
            icon={pending ? LoaderCircle : Sparkles}
            label={
              pending
                ? "改稿しています…"
                : a.aiAnswer
                  ? "AI で改稿し直す"
                  : "AI で改稿する"
            }
            size={32}
            disabled={pending}
            className={pending ? "[&_svg]:animate-spin" : ""}
            onClick={onGenerate}
          />
        </span>
      </div>
      {a.aiAnswer ? (
        <p className="m-0 text-[16px] leading-[1.8] break-words whitespace-pre-wrap">
          {a.aiAnswer}
        </p>
      ) : (
        <p className="m-0 text-[14px] text-(--text-tertiary)">
          {pending ? "改稿しています…" : "ボタンを押すと AI が改稿します。"}
        </p>
      )}
    </div>
  );
}
