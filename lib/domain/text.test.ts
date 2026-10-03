import { describe, expect, it } from "vitest";
import { countWords, detectSplitWarning, normalizeSpaces } from "./text";

describe("countWords", () => {
  it("空白で区切った語を数える", () => {
    expect(countWords("Both views contain some truth.")).toBe(5);
  });

  it("記号だけの塊は語に数えない", () => {
    expect(countWords("It was late — very late.")).toBe(5);
  });

  it("略語や数字は1語として数える", () => {
    expect(countWords("the U.S. in 1883")).toBe(4);
  });
});

describe("normalizeSpaces", () => {
  it("改行と連続する空白を1つのスペースにする", () => {
    expect(normalizeSpaces("  a\n  b\tc ")).toBe("a b c");
  });
});

describe("detectSplitWarning", () => {
  it("U.S. のような頭文字の略語で終わる文を警告する", () => {
    expect(detectSplitWarning("railways in the U.S.", "and Europe.")).toEqual({
      kind: "abbreviation",
      abbr: "U.S.",
    });
  });

  it("Mr. などの既知の略語で終わる文を警告する", () => {
    expect(detectSplitWarning("He met Mr.", "Smith there.")).toEqual({
      kind: "abbreviation",
      abbr: "Mr.",
    });
  });

  it("次の文が小文字で始まる場合を警告する", () => {
    expect(detectSplitWarning("It was 3.", "five more came.")).toEqual({
      kind: "lowercase-next",
    });
  });

  it("普通の文末は警告しない", () => {
    expect(
      detectSplitWarning("Both views contain some truth.", "The clock…"),
    ).toBeNull();
    expect(detectSplitWarning("The end.", null)).toBeNull();
  });
});
