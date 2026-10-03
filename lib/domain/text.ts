/** 空白区切りの語のうち、英数字を含むものだけを数える（「—」などの記号だけの塊は語にしない） */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** 解答の字数。原稿用紙のマス目に合わせ、改行と空白は数えない */
export function countChars(text: string): number {
  return [...text.replace(/\s/g, "")].length;
}

/** 改行や連続する空白を1つの半角スペースにそろえる */
export function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const ABBREVIATIONS = [
  "Mr.",
  "Mrs.",
  "Ms.",
  "Dr.",
  "Prof.",
  "St.",
  "Jr.",
  "Sr.",
  "vs.",
  "etc.",
  "e.g.",
  "i.e.",
  "a.m.",
  "p.m.",
  "No.",
  "Co.",
  "Inc.",
  "Ltd.",
];

export type SplitWarning =
  | { kind: "abbreviation"; abbr: string }
  | { kind: "lowercase-next" };

/**
 * LLM の文分割が略語で誤っていそうな箇所を見つける。
 * 文末が略語（Mr. / U.S. / 頭文字 など）で終わる、または次の文が小文字で始まる場合に警告する。
 */
export function detectSplitWarning(
  text: string,
  nextText: string | null,
): SplitWarning | null {
  const t = text.trim();
  const lastToken = t.split(/\s+/).at(-1) ?? "";
  const known = ABBREVIATIONS.find(
    (a) => lastToken.toLowerCase() === a.toLowerCase(),
  );
  if (known) return { kind: "abbreviation", abbr: lastToken };
  // U.S. / U.K. / J. のような大文字1字＋ピリオドの並び
  if (/^(?:[A-Z]\.)+$/.test(lastToken)) {
    return { kind: "abbreviation", abbr: lastToken };
  }
  if (nextText && /^[a-z]/.test(nextText.trim())) {
    return { kind: "lowercase-next" };
  }
  return null;
}

export function splitWarningMessage(w: SplitWarning): string {
  return w.kind === "abbreviation"
    ? `略語「${w.abbr}」で分割された可能性があります`
    : "次の文が小文字で始まっています。分割を誤った可能性があります";
}
