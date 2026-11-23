import { normalizeSpaces } from "./text";
import type { ProblemKind, Question } from "./types";

/** 小問の記号と設問文を、原文の「(ア) 下に与えられた語を…」の形でつなぐ */
export function questionText(
  q: Pick<Question, "label" | "instruction">,
): string {
  return [q.label && `(${q.label})`, q.instruction].filter(Boolean).join(" ");
}

/** 空白区切りで入力された語群を1語ずつに分ける */
export function splitWords(text: string): string[] {
  return normalizeSpaces(text).split(" ").filter(Boolean);
}

/** 新しく作る問題の小問。挿入問題には、選択肢の設問文を置く挿入の小問を1つ置く */
export function defaultQuestions(kind: ProblemKind): Question[] {
  return kind === "summary"
    ? []
    : [{ kind: "insertion", label: "", instruction: "" }];
}

/**
 * 挿入問題の小問を、挿入の小問がちょうど1つある形にそろえる。
 * 足りなければ末尾に空の小問を足し、2つ目以降は捨てる。LLM の抽出結果に使う
 */
export function ensureOneInsertion(questions: readonly Question[]): Question[] {
  let found = false;
  const out = questions.filter((q) => {
    if (q.kind !== "insertion") return true;
    if (found) return false;
    found = true;
    return true;
  });
  return found ? out : [...out, ...defaultQuestions("sentence_insertion")];
}

/** 保存する小問に問題があれば、その説明を返す */
export function questionsError(
  kind: ProblemKind,
  questions: readonly Question[],
): string | null {
  const insertions = questions.filter((q) => q.kind === "insertion").length;
  if (kind === "summary" && questions.length > 0) {
    return "要約問題には小問を置けません。";
  }
  if (kind !== "summary" && insertions !== 1) {
    return "挿入の小問はちょうど1つにしてください。";
  }
  if (questions.some((q) => q.kind === "word_order" && q.words.length === 0)) {
    return "語群が空の並べ替えがあります。";
  }
  return null;
}

/** save_problem に渡す小問の1行。種類ごとに違う中身は data 列にまとめる */
export function questionRow(q: Question) {
  return {
    label: q.label,
    kind: q.kind,
    instruction: q.instruction,
    data: q.kind === "word_order" ? { words: q.words } : {},
  };
}
