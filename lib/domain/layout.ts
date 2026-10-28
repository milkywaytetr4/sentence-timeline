import type { Sentence } from "./types";

export type PassageParagraph = {
  paragraphIndex: number;
  /** 本文の段落としての番号（1始まり）。空所だけの段落（段落挿入の空所）は null */
  number: number | null;
  rows: Sentence[];
};

export type ProblemLayout = {
  passage: PassageParagraph[];
  /** 選択肢を出題順に並べたもの */
  choices: Sentence[];
  /** 本文の段落の paragraphIndex から段落番号を引く */
  numberOf: Map<number, number>;
};

/**
 * 行を本文の段落と選択肢に分ける。段落番号は、空所だけの段落を飛ばして本文の段落だけで振る
 * （段落挿入では空所の段落が本文の間に入るため、paragraphIndex をそのまま番号にできない）。
 * 引数は paragraphIndex, sentenceIndex の順に並んでいる前提
 */
export function layoutProblem(sentences: readonly Sentence[]): ProblemLayout {
  const passage: PassageParagraph[] = [];
  const choices: Sentence[] = [];
  const numberOf = new Map<number, number>();
  for (const s of sentences) {
    if (s.kind === "choice") {
      choices.push(s);
      continue;
    }
    let para = passage.at(-1);
    if (!para || para.paragraphIndex !== s.paragraphIndex) {
      para = { paragraphIndex: s.paragraphIndex, number: null, rows: [] };
      passage.push(para);
    }
    para.rows.push(s);
    if (s.kind === "sentence" && para.number === null) {
      para.number = numberOf.size + 1;
      numberOf.set(s.paragraphIndex, para.number);
    }
  }
  return { passage, choices, numberOf };
}

/** 空所の表示。原文の「( 1 )」に合わせる */
export function blankText(label: string | null): string {
  return `( ${label ?? ""} )`;
}

/** 比較画面の棒の見出しなどで使う選択肢の名前 */
export function choiceName(choice: Pick<Sentence, "label">): string {
  return choice.label ? `選択肢 ${choice.label}` : "選択肢";
}
