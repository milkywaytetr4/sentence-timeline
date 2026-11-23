import "server-only";
import OpenAI from "openai";
import { partialParse } from "openai/_vendor/partial-json-parser/parser";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { ImageType } from "@/lib/domain/image";
import { choiceParagraphs, type PassageRow } from "@/lib/domain/passage";
import { ensureOneInsertion } from "@/lib/domain/question";
import { normalizeSpaces } from "@/lib/domain/text";
import type { ProblemKind, Question } from "@/lib/domain/types";
import { serverEnv } from "./env";

/** 途中で打ち切られた出力を読むときは、形の崩れた要素を捨てて残りを生かす */
type ListOf = <S extends z.ZodType>(item: S) => z.ZodType<z.output<S>[]>;

const lenientArray: ListOf = (item) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => item.safeParse(x).success) : []),
    z.array(item),
  );

const schemas = (array: ListOf, text: () => z.ZodType<string>) => ({
  summary: z.object({
    instruction: text(),
    paragraphs: array(z.object({ sentences: array(z.string()) })),
  }),
  insertion: z.object({
    instruction: text(),
    paragraphs: array(
      z.object({
        items: array(
          z.object({ type: z.enum(["sentence", "blank"]), text: z.string() }),
        ),
      }),
    ),
    choices: array(z.object({ label: z.string(), text: z.string() })),
    questions: array(
      z.object({
        label: z.string(),
        type: z.enum(["insertion", "word_order"]),
        instruction: z.string(),
        words: array(z.string()),
      }),
    ),
  }),
});

const strict = schemas(
  (item) => z.array(item),
  () => z.string(),
);
const lenient = schemas(lenientArray, () => z.string().catch(""));

type SummaryOutput = z.infer<typeof strict.summary>;
type InsertionOutput = z.infer<typeof strict.insertion>;

export type ExtractedPassage = {
  /** 画像に設問文が写っていなければ空文字 */
  instruction: string;
  /** 本文の段落の後ろに、選択肢の段落を続けて並べる */
  paragraphs: PassageRow[][];
  questions: Question[];
  /** コンテンツフィルターで出力が打ち切られ、途中までしか読めていない */
  truncated: boolean;
};

export type SourceImage = { bytes: Buffer; type: ImageType };

const SUMMARY_INSTRUCTIONS = `これらの画像は東京大学の入試問題、英語 第1問(A)（要約問題）のスクリーンショットです。
画像は本文の順に並んでいます。日本語の設問文と英文の本文を、それぞれ取り出してください。

設問文（instruction）
- 本文の前にある、解答の仕方を指示する日本語の文（例:「次の英文の要旨を、70〜80字の日本語でまとめよ。」）を、原文のまま写してください。
- 問題番号（「1」「(A)」など）は含めないでください。
- 紙面の幅で折り返された改行は取り除き、続けて1行にしてください。
- 設問文が写っていない場合は空文字にしてください。

本文（paragraphs）
- 英文の本文だけを、段落ごと・文ごとに分けてください。
- 設問文、問題番号、注（語注）、ページ番号、出典表記は含めないでください。
- 段落の区切りは原文の段落に合わせてください。画像をまたぐ段落は1つの段落として扱います。
- 画像同士で同じ部分が重なって写っている場合は、重複させずに1回だけ含めてください。
- 文の区切りは文末の終止符・疑問符・感嘆符で判断します。Mr. / Dr. / U.S. / e.g. などの略語や、小数点、引用符の内側にある句点では区切らないでください。
- 行末のハイフネーションで分かれた単語は元の1語に戻してください。それ以外の綴りや語句は、誤りに見えても原文のまま写してください。
- 各文の前後の空白は取り除き、文中の改行は半角スペース1つにしてください。`;

const INSERTION_TARGET: Record<Exclude<ProblemKind, "summary">, string> = {
  paragraph_insertion: "段落",
  sentence_insertion: "文",
};

const insertionInstructions = (
  kind: Exclude<ProblemKind, "summary">,
) => `これらの画像は東京大学の入試問題、英語 第1問(B) のスクリーンショットです。
本文中の空所に、選択肢から最も適した${INSERTION_TARGET[kind]}を選んで入れる問題です。
画像は問題の順に並んでいます。日本語の設問文、英文の本文（空所を含む）、選択肢、小問を、それぞれ取り出してください。

設問文（instruction）
- 本文の前にある、解答の仕方を指示する日本語の文を、原文のまま写してください。
- 本文の後ろにある小問の設問文は含めないでください（questions に入れます）。
- 問題番号（「(B)」など）は含めないでください。
- 紙面の幅で折り返された改行は取り除き、続けて1行にしてください。
- 設問文が写っていない場合は空文字にしてください。

本文（paragraphs）
- 英文の本文を段落ごとに分け、各段落を文と空所の並び（items）にしてください。
- 文は type を "sentence" にし、text に文を写してください。
- 空所（「( 1 )」のように番号を括弧で囲んだもの）は type を "blank" にし、text に括弧の中の番号だけ（例: "1"）を入れてください。
- 「( ア )」のようにカタカナを括弧で囲んだ空所は blank にせず、文の一部としてそのまま写してください。
${
  kind === "paragraph_insertion"
    ? "- この問題では空所に段落が入ります。空所は、空所1つだけを items に持つ1つの段落にしてください。"
    : "- この問題では空所に文が入ります。空所は、それが置かれている段落の中の、文の位置に入れてください。"
}
- 設問文、問題番号、注（語注）、ページ番号、出典表記、選択肢、小問の設問文と語群は含めないでください。
- 段落の区切りは原文の段落に合わせてください。画像をまたぐ段落は1つの段落として扱います。
- 画像同士で同じ部分が重なって写っている場合は、重複させずに1回だけ含めてください。
- 文の区切りは文末の終止符・疑問符・感嘆符で判断します。Mr. / Dr. / U.S. / e.g. などの略語や、小数点、引用符の内側にある句点では区切らないでください。

選択肢（choices）
- 本文の後ろにある選択肢を、出題の順に1つずつ取り出してください。
- label には記号だけ（例: "a"）を入れ、括弧や「)」は含めないでください。
- text には選択肢の英文を、記号を除いて写してください。選択肢が複数の文からなる場合も、1つの text にまとめてください。
- 小問の語群は選択肢に含めないでください。

小問（questions）
- 本文の後ろに「(ア) 下に与えられた語を正しい順に並べ替え…」「(イ) 空所(1)〜(5)に入れるのに最も適切な文を…」のような小問がある場合は、出題の順に1つずつ取り出してください。
- label には括弧の中の記号だけ（例: "ア"）を入れてください。記号がなければ空文字にしてください。
- 空所 (1) 以降に選択肢を入れる小問は type を "insertion" にしてください。insertion は1つだけです。
- 語を並べ替えて空所を埋める小問は type を "word_order" にしてください。
- instruction には小問の設問文を、記号を除いて原文のまま写してください。紙面の幅で折り返された改行は取り除き、続けて1行にしてください。
- words には、word_order なら与えられた語を表示されている順に1語ずつ入れてください。insertion なら空の配列にしてください。
- 本文の後ろに小問がなく、解答の仕方が本文の前の設問文にまとめて書かれている場合は、instruction を空文字にした insertion を1つだけ入れてください。

共通
- 行末のハイフネーションで分かれた単語は元の1語に戻してください。それ以外の綴りや語句は、誤りに見えても原文のまま写してください。
- 前後の空白は取り除き、文中の改行は半角スペース1つにしてください。`;

const CONTENT_FILTER_MESSAGE =
  "LLM の安全フィルターで抽出が止められました。本文をテキストで貼り付けて取り込んでください。";

export const EXTRACT_UNAVAILABLE_MESSAGE =
  "OPENAI_API_KEY が未設定のため、画像から本文を抽出できません。";

/** 本文抽出に必要な API キーが設定されているか */
export function canExtract(): boolean {
  return Boolean(serverEnv().OPENAI_API_KEY);
}

/**
 * スクリーンショットから設問文と英文本文を抽出する。本文は段落×行の配列で返す。
 * 抽出結果は必ず人が編集画面で確認する前提なので、ここでは形だけを検証する。
 */
export async function extractPassage(
  images: SourceImage[],
  kind: ProblemKind,
): Promise<ExtractedPassage> {
  const apiKey = serverEnv().OPENAI_API_KEY;
  if (!apiKey) throw new Error(EXTRACT_UNAVAILABLE_MESSAGE);
  const client = new OpenAI({ apiKey });

  const request = <F>(format: F, instructions: string) => ({
    model: "gpt-6-luna",
    max_output_tokens: 16000,
    reasoning: { effort: "medium" as const },
    text: { format },
    input: [
      {
        role: "user" as const,
        content: [
          ...images.map((image) => ({
            type: "input_image" as const,
            // 小さな文字を読み落とさないよう、縮小の少ない high にする
            detail: "high" as const,
            image_url: `data:${image.type.mime};base64,${image.bytes.toString("base64")}`,
          })),
          { type: "input_text" as const, text: instructions },
        ],
      },
    ],
  });

  if (kind === "summary") {
    const response = await client.responses.parse(
      request(zodTextFormat(strict.summary, "passage"), SUMMARY_INSTRUCTIONS),
    );
    const { parsed, truncated } = checkResponse(response, lenient.summary);
    return toSummaryPassage(parsed, truncated);
  }

  const response = await client.responses.parse(
    request(
      zodTextFormat(strict.insertion, "passage"),
      insertionInstructions(kind),
    ),
  );
  const { parsed, truncated } = checkResponse(response, lenient.insertion);
  return toInsertionPassage(parsed, kind, truncated);
}

function toSummaryPassage(
  parsed: SummaryOutput,
  truncated: boolean,
): ExtractedPassage {
  const paragraphs = parsed.paragraphs
    .map((p) =>
      p.sentences
        .map(normalizeSpaces)
        .filter(Boolean)
        .map((text) => ({ kind: "sentence" as const, label: null, text })),
    )
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) {
    throw new Error(
      truncated ? CONTENT_FILTER_MESSAGE : "本文を見つけられませんでした。",
    );
  }
  return {
    instruction: parsed.instruction.trim(),
    paragraphs,
    questions: [],
    truncated,
  };
}

function toInsertionPassage(
  parsed: InsertionOutput,
  kind: Exclude<ProblemKind, "summary">,
  truncated: boolean,
): ExtractedPassage {
  const passage = parsed.paragraphs
    .map((p) =>
      p.items.flatMap((item): PassageRow[] => {
        const text = normalizeSpaces(item.text);
        if (!text) return [];
        return item.type === "blank"
          ? [{ kind: "blank", label: text, text: "" }]
          : [{ kind: "sentence", label: null, text }];
      }),
    )
    .filter((p) => p.length > 0);
  if (!passage.some((p) => p.some((r) => r.kind === "sentence"))) {
    throw new Error(
      truncated ? CONTENT_FILTER_MESSAGE : "本文を見つけられませんでした。",
    );
  }
  const choices = parsed.choices
    .map((c) => ({
      label: normalizeSpaces(c.label),
      text: normalizeSpaces(c.text),
    }))
    .filter((c) => c.text);
  // 打ち切られた場合、選択肢は本文の後ろにあるので読めていないことが多い。編集画面で足してもらう
  if (choices.length === 0 && !truncated) {
    throw new Error("選択肢を見つけられませんでした。");
  }
  const questions = parsed.questions.map(
    (q): Question => ({
      ...(q.type === "word_order"
        ? { kind: q.type, words: q.words.map(normalizeSpaces).filter(Boolean) }
        : { kind: q.type }),
      label: normalizeSpaces(q.label),
      instruction: normalizeSpaces(q.instruction),
    }),
  );
  return {
    instruction: parsed.instruction.trim(),
    paragraphs: [...passage, ...choiceParagraphs(kind, choices)],
    // 打ち切られた場合や、LLM が小問の数を誤った場合でも、選択肢の設問文を置く場所は必ず作る
    questions: ensureOneInsertion(questions),
    truncated,
  };
}

/**
 * 途中で止まった応答や拒否を例外にして、構造化出力を取り出す。
 * コンテンツフィルターで打ち切られたときだけは、途中までの出力を読んで返す。
 * 著作物の本文をそのまま書き写すことが止められる原因になりやすく、プロンプトでは避けられないため。
 */
function checkResponse<T>(
  response: {
    status?: string | null;
    incomplete_details?: { reason?: string | null } | null;
    output: ReadonlyArray<
      | {
          type: "message";
          content: ReadonlyArray<{ type: string; text?: string }>;
        }
      | { type: string }
    >;
    output_parsed: T | null;
  },
  partial: z.ZodType<T>,
): { parsed: T; truncated: boolean } {
  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason;
    if (reason === "content_filter") {
      const text = response.output
        .flatMap((item) =>
          "content" in item && item.type === "message" ? item.content : [],
        )
        .map((part) => (part.type === "output_text" ? (part.text ?? "") : ""))
        .join("");
      const parsed = salvage(text, partial);
      if (!parsed) throw new Error(CONTENT_FILTER_MESSAGE);
      return { parsed, truncated: true };
    }
    throw new Error(
      reason === "max_output_tokens"
        ? "本文が長すぎて抽出が途中で終わりました。"
        : "抽出が途中で止まりました。画像の内容を確認してください。",
    );
  }
  const refused = response.output.some(
    (item) =>
      "content" in item &&
      item.type === "message" &&
      item.content.some((part) => part.type === "refusal"),
  );
  if (refused) {
    throw new Error("LLM が抽出を断りました。画像の内容を確認してください。");
  }
  const parsed = response.output_parsed;
  if (!parsed) throw new Error("LLM の出力を読み取れませんでした。");
  return { parsed, truncated: false };
}

function salvage<T>(text: string, schema: z.ZodType<T>): T | null {
  if (!text) return null;
  try {
    const result = schema.safeParse(partialParse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
