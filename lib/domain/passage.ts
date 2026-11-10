import { detectSplitWarning, normalizeSpaces } from "./text";
import type { ProblemKind, SentenceKind } from "./types";

/** 問題の1行分。段落ごとの配列に並べて sentences に保存する */
export type PassageRow = {
  kind: SentenceKind;
  label: string | null;
  text: string;
};

export type Choice = { label: string; text: string };

/**
 * 選択肢を段落にする。段落挿入では選択肢ごとに1段落、
 * 文挿入では一覧をまとめて読む時間を記録するので、一覧全体を1行にする。
 */
export function choiceParagraphs(
  kind: ProblemKind,
  choices: readonly Choice[],
): PassageRow[][] {
  if (kind === "summary" || choices.length === 0) return [];
  if (kind === "paragraph_insertion") {
    return choices.map((c) => [
      { kind: "choice", label: c.label || null, text: c.text },
    ]);
  }
  return [
    [
      {
        kind: "choice",
        label: null,
        text: choices
          .map((c) => (c.label ? `${c.label}) ${c.text}` : c.text))
          .join("\n"),
      },
    ],
  ];
}

// 「( ア )」のような語句の空所は記述式の設問なので、本文の一部として残す
const BLANK = /\(\s*(\d+)\s*\)/g;
const CHOICE_HEAD = /^\(?([a-z])\)\s+/;
const SENTENCE_END = /[.?!]["'”’)]*(?=\s+["'“‘(]?[A-Z0-9])/g;

/** 文末の終止符・疑問符・感嘆符で文に分ける。略語で終わる箇所では分けない */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length;
    const candidate = text.slice(start, end).trim();
    if (detectSplitWarning(candidate, null)?.kind === "abbreviation") continue;
    out.push(candidate);
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

function sentenceRows(text: string): PassageRow[] {
  return splitSentences(text).map((t) => ({
    kind: "sentence",
    label: null,
    text: t,
  }));
}

/** 段落の文面を、空所「( 1 )」の位置で文と空所の並びに分ける */
function splitBlanks(text: string): PassageRow[] {
  const rows: PassageRow[] = [];
  let start = 0;
  for (const m of text.matchAll(BLANK)) {
    rows.push(...sentenceRows(text.slice(start, m.index)));
    rows.push({ kind: "blank", label: m[1], text: "" });
    start = m.index + m[0].length;
  }
  rows.push(...sentenceRows(text.slice(start)));
  return rows;
}

/**
 * 貼り付けた本文を段落・文・空所・選択肢の行に分ける。LLM を使わない取り込み用。
 * - 空行で段落を区切り、段落の中の改行は空白として扱う。
 * - 挿入問題では「a) …」「(a) …」で始まる行を選択肢とし、本文の後ろにまとめる。
 * 行末のハイフネーションは戻さない。「twenty-」のように元からハイフンを含む語と区別できないため。
 */
export function parsePassageText(
  text: string,
  kind: ProblemKind,
): PassageRow[][] {
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    // 選択肢は空行を挟まずに並べて貼られることが多いので、行頭の記号でも区切る
    .flatMap((b) =>
      kind === "summary" ? [b] : b.split(/\n(?=\s*\(?[a-z]\)\s)/),
    )
    .map(normalizeSpaces)
    .filter(Boolean);

  const body: PassageRow[][] = [];
  const choices: Choice[] = [];
  for (const block of blocks) {
    const head = kind === "summary" ? null : block.match(CHOICE_HEAD);
    if (head) {
      choices.push({ label: head[1], text: block.slice(head[0].length) });
      continue;
    }
    const rows = kind === "summary" ? sentenceRows(block) : splitBlanks(block);
    if (rows.length > 0) body.push(rows);
  }
  return [...body, ...choiceParagraphs(kind, choices)];
}
