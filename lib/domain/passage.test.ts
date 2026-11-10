import { describe, expect, it } from "vitest";
import { choiceParagraphs, parsePassageText, splitSentences } from "./passage";

describe("splitSentences", () => {
  it("終止符・疑問符・感嘆符で文に分ける", () => {
    expect(splitSentences("It rained. Did it stop? Yes!")).toEqual([
      "It rained.",
      "Did it stop?",
      "Yes!",
    ]);
  });

  it("閉じ引用符は前の文に含める", () => {
    expect(splitSentences("He said “No.” Then he left.")).toEqual([
      "He said “No.”",
      "Then he left.",
    ]);
  });

  it("略語や頭文字で終わる箇所では分けない", () => {
    expect(splitSentences("Mr. Smith lives in the U.S. He is old.")).toEqual([
      "Mr. Smith lives in the U.S. He is old.",
    ]);
  });

  it("次が小文字で始まる箇所や、文中の小数点では分けない", () => {
    expect(splitSentences("It cost 1.5 euros. e.g. this one.")).toEqual([
      "It cost 1.5 euros. e.g. this one.",
    ]);
  });
});

describe("parsePassageText", () => {
  it("空行で段落を分け、段落の中の改行は空白にする", () => {
    expect(
      parsePassageText(
        "First line\ncontinues. Second.\n\nNext one.",
        "summary",
      ),
    ).toEqual([
      [
        { kind: "sentence", label: null, text: "First line continues." },
        { kind: "sentence", label: null, text: "Second." },
      ],
      [{ kind: "sentence", label: null, text: "Next one." }],
    ]);
  });

  it("番号の空所を空所の行にし、前後の文と分ける", () => {
    expect(
      parsePassageText(
        "( 1 ) Afterward, all left. They slept. ( 4 )",
        "sentence_insertion",
      ),
    ).toEqual([
      [
        { kind: "blank", label: "1", text: "" },
        { kind: "sentence", label: null, text: "Afterward, all left." },
        { kind: "sentence", label: null, text: "They slept." },
        { kind: "blank", label: "4", text: "" },
      ],
    ]);
  });

  it("語句の空所「( ア )」は本文の一部として残す", () => {
    expect(
      parsePassageText(
        "The poor are likely to ( ア ) there.",
        "sentence_insertion",
      ),
    ).toEqual([
      [
        {
          kind: "sentence",
          label: null,
          text: "The poor are likely to ( ア ) there.",
        },
      ],
    ]);
  });

  it("文挿入では選択肢を一覧全体で1行にして本文の後ろに置く", () => {
    expect(
      parsePassageText(
        "a) But why\nis it risky?\nb) The whole process.\n\nBody text.",
        "sentence_insertion",
      ),
    ).toEqual([
      [{ kind: "sentence", label: null, text: "Body text." }],
      [
        {
          kind: "choice",
          label: null,
          text: "a) But why is it risky?\nb) The whole process.",
        },
      ],
    ]);
  });

  it("段落挿入では空所だけの段落と、選択肢ごとの段落を作る", () => {
    expect(
      parsePassageText(
        "Intro.\n\n( 1 )\n\n(a) Choice one.\n(b) Choice two.",
        "paragraph_insertion",
      ),
    ).toEqual([
      [{ kind: "sentence", label: null, text: "Intro." }],
      [{ kind: "blank", label: "1", text: "" }],
      [{ kind: "choice", label: "a", text: "Choice one." }],
      [{ kind: "choice", label: "b", text: "Choice two." }],
    ]);
  });

  it("要約問題では空所や選択肢を探さない", () => {
    expect(parsePassageText("a) It is ( 1 ) here.", "summary")).toEqual([
      [{ kind: "sentence", label: null, text: "a) It is ( 1 ) here." }],
    ]);
  });
});

describe("choiceParagraphs", () => {
  it("記号のない選択肢は、文挿入の一覧で記号を付けずに並べる", () => {
    expect(
      choiceParagraphs("sentence_insertion", [
        { label: "", text: "One." },
        { label: "b", text: "Two." },
      ]),
    ).toEqual([[{ kind: "choice", label: null, text: "One.\nb) Two." }]]);
  });

  it("選択肢がなければ段落を作らない", () => {
    expect(choiceParagraphs("paragraph_insertion", [])).toEqual([]);
  });
});
