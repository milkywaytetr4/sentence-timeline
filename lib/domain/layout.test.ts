import { describe, expect, it } from "vitest";
import { layoutProblem } from "./layout";
import type { Sentence, SentenceKind } from "./types";

const row = (
  id: string,
  paragraphIndex: number,
  sentenceIndex: number,
  kind: SentenceKind = "sentence",
  label: string | null = null,
): Sentence => ({
  id,
  paragraphIndex,
  sentenceIndex,
  kind,
  label,
  text: id,
  wordCount: 1,
});

describe("layoutProblem", () => {
  it("要約問題では段落の順に番号を振る", () => {
    const l = layoutProblem([
      row("s1", 0, 0),
      row("s2", 0, 1),
      row("s3", 1, 0),
    ]);
    expect(l.passage.map((p) => [p.number, p.rows.map((r) => r.id)])).toEqual([
      [1, ["s1", "s2"]],
      [2, ["s3"]],
    ]);
    expect(l.choices).toEqual([]);
  });

  it("段落挿入では空所だけの段落に番号を振らず、本文の段落だけで数える", () => {
    const l = layoutProblem([
      row("s1", 0, 0),
      row("b1", 1, 0, "blank", "1"),
      row("s2", 2, 0),
      row("ca", 3, 0, "choice", "a"),
      row("cb", 4, 0, "choice", "b"),
    ]);
    expect(l.passage.map((p) => p.number)).toEqual([1, null, 2]);
    expect(l.numberOf.get(2)).toBe(2);
    expect(l.choices.map((c) => c.id)).toEqual(["ca", "cb"]);
  });

  it("文挿入では空所を段落の中に残す", () => {
    const l = layoutProblem([
      row("s1", 0, 0),
      row("b1", 0, 1, "blank", "1"),
      row("s2", 0, 2),
      row("c", 1, 0, "choice"),
    ]);
    expect(l.passage).toHaveLength(1);
    expect(l.passage[0].rows.map((r) => r.id)).toEqual(["s1", "b1", "s2"]);
    expect(l.choices.map((c) => c.id)).toEqual(["c"]);
  });
});
