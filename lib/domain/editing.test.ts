import { describe, expect, it } from "vitest";
import {
  type EditParagraph,
  fromSentences,
  joinWithPreviousParagraph,
  mergeWithPrevious,
  removeRow,
  splitAt,
  startParagraphAt,
} from "./editing";

let n = 0;
const newKey = () => `n${++n}`;

const texts = (paras: EditParagraph[]) =>
  paras.map((p) => p.rows.map((r) => r.text));

function sample(): EditParagraph[] {
  return [
    {
      key: "p1",
      rows: [
        {
          key: "r1",
          id: "s1",
          kind: "sentence",
          label: null,
          text: "railways in the U.S.",
        },
        {
          key: "r2",
          id: "s2",
          kind: "sentence",
          label: null,
          text: "and Europe.",
        },
      ],
    },
    {
      key: "p2",
      rows: [
        {
          key: "r3",
          id: "s3",
          kind: "sentence",
          label: null,
          text: "Next paragraph.",
        },
      ],
    },
  ];
}

describe("fromSentences", () => {
  it("段落番号ごとに文をまとめる", () => {
    const paras = fromSentences(
      [
        {
          id: "a",
          paragraphIndex: 0,
          sentenceIndex: 0,
          kind: "sentence",
          label: null,
          text: "A.",
          wordCount: 1,
        },
        {
          id: "b",
          paragraphIndex: 0,
          sentenceIndex: 1,
          kind: "sentence",
          label: null,
          text: "B.",
          wordCount: 1,
        },
        {
          id: "c",
          paragraphIndex: 1,
          sentenceIndex: 0,
          kind: "sentence",
          label: null,
          text: "C.",
          wordCount: 1,
        },
      ],
      newKey,
    );
    expect(texts(paras)).toEqual([["A.", "B."], ["C."]]);
  });
});

describe("mergeWithPrevious", () => {
  it("前の文に空白1つでつなぎ、前の文の id を残す", () => {
    const out = mergeWithPrevious(sample(), 0, 1);
    expect(out[0].rows).toEqual([
      {
        key: "r1",
        id: "s1",
        kind: "sentence",
        label: null,
        text: "railways in the U.S. and Europe.",
      },
    ]);
  });

  it("段落の先頭の文は前の段落の最後の文につなぎ、空になった段落を消す", () => {
    const out = mergeWithPrevious(sample(), 1, 0);
    expect(texts(out)).toEqual([
      ["railways in the U.S.", "and Europe. Next paragraph."],
    ]);
  });

  it("空所や選択肢とは結合しない", () => {
    const paras = sample();
    paras[1].rows[0] = { ...paras[1].rows[0], kind: "blank", label: "1" };
    expect(texts(mergeWithPrevious(paras, 1, 0))).toEqual(texts(paras));
  });

  it("元の配列を変更しない", () => {
    const before = sample();
    mergeWithPrevious(before, 0, 1);
    expect(texts(before)).toEqual(texts(sample()));
  });
});

describe("splitAt", () => {
  it("指定位置で分け、後ろ側を id のない新しい文にする", () => {
    const out = splitAt(sample(), 1, 0, 5, newKey);
    expect(out?.[1].rows.map((r) => [r.id, r.text])).toEqual([
      ["s3", "Next"],
      [null, "paragraph."],
    ]);
  });

  it("文の先頭や末尾では分けない", () => {
    expect(splitAt(sample(), 1, 0, 0, newKey)).toBeNull();
    expect(splitAt(sample(), 1, 0, 15, newKey)).toBeNull();
  });
});

describe("段落の操作", () => {
  it("段落を前の段落につなげる", () => {
    expect(texts(joinWithPreviousParagraph(sample(), 1))).toEqual([
      ["railways in the U.S.", "and Europe.", "Next paragraph."],
    ]);
  });

  it("指定した文から後ろを新しい段落にする", () => {
    expect(texts(startParagraphAt(sample(), 0, 1, newKey))).toEqual([
      ["railways in the U.S."],
      ["and Europe."],
      ["Next paragraph."],
    ]);
  });

  it("文を消して空になった段落も消す", () => {
    expect(texts(removeRow(sample(), 1, 0))).toEqual([
      ["railways in the U.S.", "and Europe."],
    ]);
  });
});
