import "server-only";
import type {
  Attempt,
  AttemptStatus,
  EventType,
  Problem,
  ProblemKind,
  Role,
  Sentence,
  SentenceKind,
  StoredEvent,
} from "@/lib/domain/types";
import { db } from "./db";

type ProblemRow = {
  id: string;
  title: string;
  year: string;
  question_no: string;
  kind: ProblemKind;
  instruction: string;
  created_at: string;
};
type SentenceRow = {
  id: string;
  paragraph_index: number;
  sentence_index: number;
  kind: SentenceKind;
  label: string | null;
  text: string;
  word_count: number;
};
type AttemptRow = {
  id: string;
  problem_id: string;
  role: Role;
  attempt_no: number;
  status: AttemptStatus;
  started_at: string;
  finished_at: string | null;
  answer: string | null;
  ai_answer: string | null;
};
type EventRow = {
  id: string;
  seq: number;
  type: EventType;
  sentence_id: string | null;
  client_ts: string;
  voided: boolean;
};

const toProblem = (r: ProblemRow): Problem => ({
  id: r.id,
  title: r.title,
  year: r.year,
  questionNo: r.question_no,
  kind: r.kind,
  instruction: r.instruction,
  createdAt: r.created_at,
});

const toSentence = (r: SentenceRow): Sentence => ({
  id: r.id,
  paragraphIndex: r.paragraph_index,
  sentenceIndex: r.sentence_index,
  kind: r.kind,
  label: r.label,
  text: r.text,
  wordCount: r.word_count,
});

const sortSentences = (a: Sentence, b: Sentence) =>
  a.paragraphIndex - b.paragraphIndex || a.sentenceIndex - b.sentenceIndex;

const toAttempt = (r: AttemptRow): Attempt => ({
  id: r.id,
  problemId: r.problem_id,
  role: r.role,
  attemptNo: r.attempt_no,
  status: r.status,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  answer: r.answer,
  aiAnswer: r.ai_answer,
});

const toEvent = (r: EventRow): StoredEvent => ({
  id: r.id,
  seq: r.seq,
  type: r.type,
  sentenceId: r.sentence_id,
  clientTs: Date.parse(r.client_ts),
  voided: r.voided,
});

export type AttemptWithEvents = Attempt & { events: StoredEvent[] };

export type ProblemSummary = Problem & {
  paragraphCount: number;
  sentenceCount: number;
  attempts: AttemptWithEvents[];
};

const ATTEMPT_WITH_EVENTS =
  "id, problem_id, role, attempt_no, status, started_at, finished_at, answer, ai_answer, events(id, seq, type, sentence_id, client_ts, voided)";

function toAttemptWithEvents(
  r: AttemptRow & { events: EventRow[] },
): AttemptWithEvents {
  return {
    ...toAttempt(r),
    events: r.events.map(toEvent).sort((a, b) => a.seq - b.seq),
  };
}

const byStarted = (a: Attempt, b: Attempt) =>
  a.startedAt.localeCompare(b.startedAt);

export async function listProblems(): Promise<ProblemSummary[]> {
  const { data, error } = await db()
    .from("problems")
    .select(
      `id, title, year, question_no, kind, instruction, created_at, sentences(paragraph_index, kind), attempts(${ATTEMPT_WITH_EVENTS})`,
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  type Row = ProblemRow & {
    sentences: { paragraph_index: number; kind: SentenceKind }[];
    attempts: (AttemptRow & { events: EventRow[] })[];
  };
  return (data as Row[]).map((r) => {
    // 空所と選択肢は本文の段落・文に数えない
    const body = r.sentences.filter((s) => s.kind === "sentence");
    return {
      ...toProblem(r),
      paragraphCount: new Set(body.map((s) => s.paragraph_index)).size,
      sentenceCount: body.length,
      attempts: r.attempts.map(toAttemptWithEvents).sort(byStarted),
    };
  });
}

export async function listProblemHeads(): Promise<Problem[]> {
  const { data, error } = await db()
    .from("problems")
    .select("id, title, year, question_no, kind, instruction, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ProblemRow[]).map(toProblem);
}

export async function getProblemWithSentences(
  id: string,
): Promise<{ problem: Problem; sentences: Sentence[] } | null> {
  const { data, error } = await db()
    .from("problems")
    .select(
      "id, title, year, question_no, kind, instruction, created_at, sentences(id, paragraph_index, sentence_index, kind, label, text, word_count)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as ProblemRow & { sentences: SentenceRow[] };
  return {
    problem: toProblem(row),
    sentences: row.sentences.map(toSentence).sort(sortSentences),
  };
}

export async function getAttemptWithEvents(
  id: string,
): Promise<AttemptWithEvents | null> {
  const { data, error } = await db()
    .from("attempts")
    .select(ATTEMPT_WITH_EVENTS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toAttemptWithEvents(data as AttemptRow & { events: EventRow[] });
}

export async function listAttemptsWithEvents(
  problemId: string,
): Promise<AttemptWithEvents[]> {
  const { data, error } = await db()
    .from("attempts")
    .select(ATTEMPT_WITH_EVENTS)
    .eq("problem_id", problemId);
  if (error) throw error;
  return (data as (AttemptRow & { events: EventRow[] })[])
    .map(toAttemptWithEvents)
    .sort(byStarted);
}

export async function getAttemptOwner(
  id: string,
): Promise<{ role: Role; problemId: string } | null> {
  const { data, error } = await db()
    .from("attempts")
    .select("role, problem_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { role: data.role as Role, problemId: data.problem_id as string };
}

export async function problemHasAttempts(problemId: string): Promise<boolean> {
  const { count, error } = await db()
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("problem_id", problemId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function getAttemptAnswer(
  id: string,
): Promise<{ problemId: string; answer: string | null } | null> {
  const { data, error } = await db()
    .from("attempts")
    .select("problem_id, answer")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    problemId: data.problem_id as string,
    answer: data.answer as string | null,
  };
}
