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

export type Sentence = {
  id: string;
  paragraphIndex: number;
  sentenceIndex: number;
  text: string;
  wordCount: number;
};

export type Problem = {
  id: string;
  title: string;
  year: string;
  questionNo: string;
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
