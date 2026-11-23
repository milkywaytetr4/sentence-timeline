export type Role = "teacher" | "student";

export const ROLE_LABEL: Record<Role, string> = {
  teacher: "先生",
  student: "生徒",
};

export type EventType =
  | "start"
  | "finish"
  | "focus"
  | "read_done"
  | "unfocus"
  | "pause"
  | "resume";

export type AttemptStatus = "in_progress" | "done" | "abandoned";

/** 計算用に正規化したイベント。clientTs は epoch ミリ秒 */
export type TimelineEvent = {
  id: string;
  seq: number;
  type: EventType;
  sentenceId: string | null;
  clientTs: number;
};

export type StoredEvent = TimelineEvent & { voided: boolean };

/**
 * - summary: 第1問(A)（要約）
 * - paragraph_insertion / sentence_insertion: 第1問(B)の段落挿入・文挿入
 */
export type ProblemKind =
  | "summary"
  | "paragraph_insertion"
  | "sentence_insertion";

export const PROBLEM_KIND_LABEL: Record<ProblemKind, string> = {
  summary: "要約",
  paragraph_insertion: "段落挿入",
  sentence_insertion: "文挿入",
};

/**
 * - sentence: 本文の文
 * - blank: 本文中の空所。label は空所の番号
 * - choice: 選択肢。段落挿入では選択肢1つ（label は記号）、文挿入では選択肢の一覧全体（label は null）
 */
export type SentenceKind = "sentence" | "blank" | "choice";

export type Sentence = {
  id: string;
  paragraphIndex: number;
  sentenceIndex: number;
  kind: SentenceKind;
  label: string | null;
  text: string;
  wordCount: number;
};

/**
 * 本文の後ろに印刷されている小問。計測はしない
 * - insertion: 空所に段落・文を入れる小問。選択肢は Sentence（kind = "choice"）として持つ
 * - word_order: 語の並べ替え
 */
export type QuestionKind = "insertion" | "word_order";

export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = {
  insertion: "挿入",
  word_order: "並べ替え",
};

export type Question = {
  /** 「ア」のような記号。括弧は含めない。無ければ空文字 */
  label: string;
  instruction: string;
} & ({ kind: "insertion" } | { kind: "word_order"; words: string[] });

export type Problem = {
  id: string;
  title: string;
  year: string;
  questionNo: string;
  kind: ProblemKind;
  /** 計測画面で本文の上に出す設問文 */
  instruction: string;
  createdAt: string;
};

export type Attempt = {
  id: string;
  problemId: string;
  role: Role;
  attemptNo: number;
  status: AttemptStatus;
  startedAt: string;
  finishedAt: string | null;
  /** 解答完了の前は null */
  answer: string | null;
  /** 解答の書き口を残して LLM が改稿した解答。改稿していなければ null */
  aiAnswer: string | null;
};

/** 大問番号「1(A)」を「第1問(A)」の形にして、年度・タイトルと並べる */
export function problemLabel(
  p: Pick<Problem, "title" | "year" | "questionNo">,
) {
  const q = p.questionNo.trim();
  const m = q.match(/^(\d+)(.*)$/);
  const qLabel = m ? `第${m[1]}問${m[2]}` : q;
  const head = [qLabel, p.year.trim()].filter(Boolean).join(" ");
  return head ? `${head} · ${p.title}` : p.title;
}

export function attemptLabel(a: Pick<Attempt, "role" | "attemptNo">) {
  return `${ROLE_LABEL[a.role]} ${a.attemptNo}回目`;
}
