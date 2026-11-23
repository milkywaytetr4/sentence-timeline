import { describe, expect, it } from "vitest";
import {
  defaultQuestions,
  ensureOneInsertion,
  questionRow,
  questionsError,
  questionText,
  splitWords,
} from "./question";
import type { Question } from "./types";

const insertion = (instruction = ""): Question => ({
  kind: "insertion",
  label: "イ",
  instruction,
});
const wordOrder = (words: string[]): Question => ({
  kind: "word_order",
  label: "ア",
  instruction: "並べ替えよ。",
  words,
});

describe("questionText", () => {
  it("記号を括弧で囲んで設問文の前に置く", () => {
    expect(questionText({ label: "ア", instruction: "並べ替えよ。" })).toBe(
      "(ア) 並べ替えよ。",
    );
  });

  it("記号がなければ設問文だけにする", () => {
    expect(questionText({ label: "", instruction: "選べ。" })).toBe("選べ。");
  });
});

describe("splitWords", () => {
  it("空白や改行で区切られた語群を1語ずつに分ける", () => {
    expect(splitWords("  cars get\nin  mosquitoes ")).toEqual([
      "cars",
      "get",
      "in",
      "mosquitoes",
    ]);
  });

  it("空白だけなら空の配列になる", () => {
    expect(splitWords("  \n ")).toEqual([]);
  });
});

describe("defaultQuestions", () => {
  it("要約問題には小問を置かない", () => {
    expect(defaultQuestions("summary")).toEqual([]);
  });

  it("挿入問題には空の挿入の小問を1つ置く", () => {
    expect(defaultQuestions("paragraph_insertion")).toEqual([
      { kind: "insertion", label: "", instruction: "" },
    ]);
  });
});

describe("ensureOneInsertion", () => {
  it("挿入の小問がなければ末尾に空の小問を足す", () => {
    expect(ensureOneInsertion([wordOrder(["a"])])).toEqual([
      wordOrder(["a"]),
      { kind: "insertion", label: "", instruction: "" },
    ]);
  });

  it("挿入の小問が複数あれば最初の1つだけを残す", () => {
    expect(
      ensureOneInsertion([
        insertion("1つ目"),
        wordOrder(["a"]),
        insertion("2つ目"),
      ]),
    ).toEqual([insertion("1つ目"), wordOrder(["a"])]);
  });
});

describe("questionsError", () => {
  it("挿入問題で挿入の小問が1つなら問題なし", () => {
    expect(
      questionsError("sentence_insertion", [wordOrder(["a"]), insertion()]),
    ).toBeNull();
  });

  it("挿入問題で挿入の小問がなければエラー", () => {
    expect(
      questionsError("sentence_insertion", [wordOrder(["a"])]),
    ).not.toBeNull();
  });

  it("要約問題に小問があればエラー", () => {
    expect(questionsError("summary", [insertion()])).not.toBeNull();
  });

  it("語群が空の並べ替えがあればエラー", () => {
    expect(
      questionsError("sentence_insertion", [wordOrder([]), insertion()]),
    ).not.toBeNull();
  });
});

describe("questionRow", () => {
  it("並べ替えは語群を data に入れ、挿入は data を空にする", () => {
    expect(questionRow(wordOrder(["a", "b"]))).toEqual({
      label: "ア",
      kind: "word_order",
      instruction: "並べ替えよ。",
      data: { words: ["a", "b"] },
    });
    expect(questionRow(insertion()).data).toEqual({});
  });
});
