import type { TimelineEvent } from "./types";

/**
 * 記録はイベントログだけを正とし、画面の状態もタイムラインも
 * 取り消されていないイベントを seq 順にたどって毎回計算し直す。
 */

export type Phase = "reading" | "answer" | "done";

export type RecorderState = {
  started: boolean;
  phase: Phase;
  /** 読解中に見ている文、または答案作成中に見返している文 */
  focusedId: string | null;
  paused: boolean;
  /** 読解フェーズで一度でも見た文 */
  visited: Set<string>;
};

const bySeq = (a: TimelineEvent, b: TimelineEvent) => a.seq - b.seq;

export function deriveState(events: readonly TimelineEvent[]): RecorderState {
  const s: RecorderState = {
    started: false,
    phase: "reading",
    focusedId: null,
    paused: false,
    visited: new Set(),
  };
  for (const ev of [...events].sort(bySeq)) {
    switch (ev.type) {
      case "start":
        s.started = true;
        break;
      case "focus":
        s.focusedId = ev.sentenceId;
        if (s.phase === "reading" && ev.sentenceId)
          s.visited.add(ev.sentenceId);
        break;
      case "unfocus":
        s.focusedId = null;
        break;
      case "read_done":
        s.phase = "answer";
        s.focusedId = null;
        break;
      case "pause":
        s.paused = true;
        break;
      case "resume":
        s.paused = false;
        break;
      case "finish":
        s.phase = "done";
        s.focusedId = null;
        s.paused = false;
        break;
    }
  }
  return s;
}

/**
 * - sentence: 文を見ている（読解中の閲覧、または答案作成中の見返し）
 * - writing: 答案作成中で本文を見ていない
 * - idle: 開始してから最初の文をタップするまで
 */
export type SegmentKind = "sentence" | "writing" | "idle";

export type Segment = {
  kind: SegmentKind;
  sentenceId: string | null;
  /** 一時停止を除いた経過秒 */
  start: number;
  duration: number;
  /** 読了後の見返しかどうか */
  review: boolean;
};

export type Timeline = {
  segments: Segment[];
  readDoneAt: number | null;
  /** 一時停止を除いた合計秒。未完了の取り組みは最後のイベントまで */
  total: number;
  finished: boolean;
};

type Cursor = { kind: SegmentKind; sentenceId: string | null; review: boolean };

export function buildTimeline(events: readonly TimelineEvent[]): Timeline {
  const sorted = [...events].sort(bySeq);
  const segments: Segment[] = [];
  let cursor: Cursor | null = null;
  let phase: Phase = "reading";
  let paused = false;
  let lastTs: number | null = null;
  let elapsed = 0;
  let readDoneAt: number | null = null;

  const push = (c: Cursor, duration: number) => {
    if (duration <= 0) return;
    const last = segments.at(-1);
    // 一時停止をはさんで同じ文を見続けた場合などは1本の棒にまとめる
    if (
      last &&
      last.kind === c.kind &&
      last.sentenceId === c.sentenceId &&
      last.review === c.review
    ) {
      last.duration += duration;
    } else {
      segments.push({ ...c, start: elapsed, duration });
    }
    elapsed += duration;
  };

  for (const ev of sorted) {
    if (cursor && !paused && lastTs !== null) {
      // 端末の時計が巻き戻った場合に負の幅を作らない
      push(cursor, Math.max(0, (ev.clientTs - lastTs) / 1000));
    }
    lastTs = ev.clientTs;

    switch (ev.type) {
      case "start":
        cursor = { kind: "idle", sentenceId: null, review: false };
        break;
      case "focus":
        cursor = {
          kind: "sentence",
          sentenceId: ev.sentenceId,
          review: phase === "answer",
        };
        break;
      case "unfocus":
        cursor = { kind: "writing", sentenceId: null, review: false };
        break;
      case "read_done":
        phase = "answer";
        readDoneAt = elapsed;
        cursor = { kind: "writing", sentenceId: null, review: false };
        break;
      case "pause":
        paused = true;
        break;
      case "resume":
        paused = false;
        break;
      case "finish":
        phase = "done";
        cursor = null;
        break;
    }
  }

  return { segments, readDoneAt, total: elapsed, finished: phase === "done" };
}

/** 計測画面の経過時間表示用。最後のイベント以降の時間も含める */
export function elapsedSeconds(
  events: readonly TimelineEvent[],
  now: number,
): number {
  const tl = buildTimeline(events);
  const state = deriveState(events);
  const last = [...events].sort(bySeq).at(-1);
  if (!last || state.paused || state.phase === "done") return tl.total;
  return tl.total + Math.max(0, (now - last.clientTs) / 1000);
}

export type ParagraphSegment = {
  kind: SegmentKind;
  paragraphIndex: number | null;
  sentenceIds: string[];
  start: number;
  duration: number;
  review: boolean;
};

/** 段落表示用に、隣り合う同じ段落（または同じ種類の無彩色区間）の棒をまとめる */
export function mergeByParagraph(
  segments: readonly Segment[],
  paragraphOf: (sentenceId: string) => number,
): ParagraphSegment[] {
  const out: ParagraphSegment[] = [];
  for (const seg of segments) {
    const p = seg.sentenceId ? paragraphOf(seg.sentenceId) : null;
    const last = out.at(-1);
    if (
      last &&
      last.kind === seg.kind &&
      last.paragraphIndex === p &&
      last.review === seg.review
    ) {
      last.duration += seg.duration;
      if (seg.sentenceId && !last.sentenceIds.includes(seg.sentenceId)) {
        last.sentenceIds.push(seg.sentenceId);
      }
    } else {
      out.push({
        kind: seg.kind,
        paragraphIndex: p,
        sentenceIds: seg.sentenceId ? [seg.sentenceId] : [],
        start: seg.start,
        duration: seg.duration,
        review: seg.review,
      });
    }
  }
  return out;
}

export function wordsPerMinute(words: number, seconds: number): number | null {
  if (seconds < 1) return null;
  return Math.round(words / (seconds / 60));
}

export function formatClock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 取り消し（Undo）の対象にするイベント。開始と一時停止・再開は対象外 */
export const UNDOABLE_TYPES = new Set([
  "focus",
  "unfocus",
  "read_done",
  "finish",
]);
