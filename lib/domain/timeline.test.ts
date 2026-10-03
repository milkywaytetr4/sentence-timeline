import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  deriveState,
  elapsedSeconds,
  formatClock,
  mergeByParagraph,
  wordsPerMinute,
} from "./timeline";
import type { EventType, TimelineEvent } from "./types";

const T0 = Date.UTC(2026, 9, 1, 0, 0, 0);

/** [経過秒, 種類, 文id] の並びからイベント列を作る */
function log(...rows: [number, EventType, string?][]): TimelineEvent[] {
  return rows.map(([sec, type, sentenceId], i) => ({
    id: `e${i}`,
    seq: i,
    type,
    sentenceId: sentenceId ?? null,
    clientTs: T0 + sec * 1000,
  }));
}

describe("deriveState", () => {
  it("読解中は最後にタップした文を閲覧中とし、見た文を記録する", () => {
    const s = deriveState(
      log([0, "start"], [2, "focus", "a"], [10, "focus", "b"]),
    );
    expect(s.phase).toBe("reading");
    expect(s.focusedId).toBe("b");
    expect([...s.visited]).toEqual(["a", "b"]);
  });

  it("読了後は本文を見ていない状態になり、文のタップは見返しとして扱う", () => {
    const s = deriveState(
      log(
        [0, "start"],
        [2, "focus", "a"],
        [10, "read_done"],
        [20, "focus", "a"],
      ),
    );
    expect(s.phase).toBe("answer");
    expect(s.focusedId).toBe("a");
  });

  it("見返し中の文は visited に加えない", () => {
    const s = deriveState(
      log([0, "start"], [1, "read_done"], [2, "focus", "z"]),
    );
    expect(s.visited.has("z")).toBe(false);
  });

  it("一時停止と再開を反映する", () => {
    expect(deriveState(log([0, "start"], [1, "pause"])).paused).toBe(true);
    expect(
      deriveState(log([0, "start"], [1, "pause"], [5, "resume"])).paused,
    ).toBe(false);
  });

  it("イベントの並び順ではなく seq の順に処理する", () => {
    const events = log(
      [0, "start"],
      [1, "focus", "a"],
      [2, "focus", "b"],
    ).reverse();
    expect(deriveState(events).focusedId).toBe("b");
  });
});

describe("buildTimeline", () => {
  it("文が切り替わるまでの時間をその文の閲覧時間にする（手が止まった時間も含む）", () => {
    const tl = buildTimeline(
      log(
        [0, "start"],
        [3, "focus", "a"],
        [33, "focus", "b"],
        [40, "read_done"],
        [100, "finish"],
      ),
    );
    expect(tl.segments).toEqual([
      { kind: "idle", sentenceId: null, start: 0, duration: 3, review: false },
      {
        kind: "sentence",
        sentenceId: "a",
        start: 3,
        duration: 30,
        review: false,
      },
      {
        kind: "sentence",
        sentenceId: "b",
        start: 33,
        duration: 7,
        review: false,
      },
      {
        kind: "writing",
        sentenceId: null,
        start: 40,
        duration: 60,
        review: false,
      },
    ]);
    expect(tl.readDoneAt).toBe(40);
    expect(tl.total).toBe(100);
    expect(tl.finished).toBe(true);
  });

  it("戻り読みは同じ文の別の棒として残る", () => {
    const tl = buildTimeline(
      log(
        [0, "start"],
        [0, "focus", "a"],
        [10, "focus", "b"],
        [20, "focus", "a"],
        [25, "read_done"],
      ),
    );
    expect(tl.segments.map((s) => [s.sentenceId, s.duration])).toEqual([
      ["a", 10],
      ["b", 10],
      ["a", 5],
    ]);
  });

  it("答案作成中の見返しは review として記録し、終了後は答案作成に戻る", () => {
    const tl = buildTimeline(
      log(
        [0, "start"],
        [0, "focus", "a"],
        [10, "read_done"],
        [30, "focus", "a"],
        [38, "unfocus"],
        [50, "finish"],
      ),
    );
    expect(tl.segments.slice(1)).toEqual([
      {
        kind: "writing",
        sentenceId: null,
        start: 10,
        duration: 20,
        review: false,
      },
      {
        kind: "sentence",
        sentenceId: "a",
        start: 30,
        duration: 8,
        review: true,
      },
      {
        kind: "writing",
        sentenceId: null,
        start: 38,
        duration: 12,
        review: false,
      },
    ]);
  });

  it("一時停止中の時間はどの文にも加算せず、前後の同じ文は1本にまとめる", () => {
    const tl = buildTimeline(
      log(
        [0, "start"],
        [0, "focus", "a"],
        [10, "pause"],
        [70, "resume"],
        [75, "focus", "b"],
      ),
    );
    expect(tl.segments).toEqual([
      {
        kind: "sentence",
        sentenceId: "a",
        start: 0,
        duration: 15,
        review: false,
      },
    ]);
    expect(tl.total).toBe(15);
  });

  it("未完了の取り組みは最後のイベントまでを合計にする", () => {
    const tl = buildTimeline(
      log([0, "start"], [5, "focus", "a"], [20, "focus", "b"]),
    );
    expect(tl.total).toBe(20);
    expect(tl.finished).toBe(false);
    expect(tl.readDoneAt).toBeNull();
  });

  it("端末の時計が巻き戻っても負の長さの棒を作らない", () => {
    const tl = buildTimeline(
      log([10, "start"], [5, "focus", "a"], [15, "focus", "b"]),
    );
    expect(tl.segments.every((s) => s.duration >= 0)).toBe(true);
    expect(tl.total).toBe(10);
  });
});

describe("elapsedSeconds", () => {
  it("計測中は最後のイベントから現在までの時間も含める", () => {
    const events = log([0, "start"], [10, "focus", "a"]);
    expect(elapsedSeconds(events, T0 + 25_000)).toBe(25);
  });

  it("一時停止中は時間が進まない", () => {
    const events = log([0, "start"], [10, "focus", "a"], [20, "pause"]);
    expect(elapsedSeconds(events, T0 + 500_000)).toBe(20);
  });
});

describe("mergeByParagraph", () => {
  const paragraphOf = (id: string) => ({ a: 0, b: 0, c: 1 })[id] ?? -1;

  it("隣り合う同じ段落の棒をまとめ、含まれる文を重複なく持つ", () => {
    const tl = buildTimeline(
      log(
        [0, "start"],
        [0, "focus", "a"],
        [10, "focus", "b"],
        [20, "focus", "a"],
        [25, "focus", "c"],
        [40, "read_done"],
      ),
    );
    const merged = mergeByParagraph(tl.segments, paragraphOf);
    expect(
      merged.map((m) => [m.paragraphIndex, m.duration, m.sentenceIds]),
    ).toEqual([
      [0, 25, ["a", "b"]],
      [1, 15, ["c"]],
    ]);
  });

  it("見返しと読解中の閲覧は、同じ段落でも別の棒にする", () => {
    const tl = buildTimeline(
      log(
        [0, "start"],
        [0, "focus", "a"],
        [10, "read_done"],
        [10, "focus", "b"],
        [20, "unfocus"],
      ),
    );
    const merged = mergeByParagraph(tl.segments, paragraphOf);
    expect(merged.map((m) => [m.kind, m.review])).toEqual([
      ["sentence", false],
      ["sentence", true],
    ]);
  });
});

describe("表示用の計算", () => {
  it("wpm は語数を分に換算した時間で割る", () => {
    expect(wordsPerMinute(30, 15)).toBe(120);
  });

  it("1秒未満の閲覧は wpm を出さない", () => {
    expect(wordsPerMinute(30, 0.5)).toBeNull();
  });

  it("秒を「分:秒」で表す", () => {
    expect(formatClock(735)).toBe("12:15");
    expect(formatClock(59.6)).toBe("1:00");
  });
});
