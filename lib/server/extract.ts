import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { ImageType } from "@/lib/domain/image";
import { normalizeSpaces } from "@/lib/domain/text";
import type { ProblemKind, SentenceKind } from "@/lib/domain/types";
import { serverEnv } from "./env";

const extractionSchema = z.object({
  instruction: z.string(),
  paragraphs: z.array(
    z.object({
      sentences: z.array(z.string()),
    }),
  ),
});

const insertionSchema = z.object({
  instruction: z.string(),
  paragraphs: z.array(
    z.object({
      items: z.array(
        z.object({
          type: z.enum(["sentence", "blank"]),
          text: z.string(),
        }),
      ),
    }),
  ),
  choices: z.array(z.object({ label: z.string(), text: z.string() })),
});

export type ExtractedRow = {
  kind: SentenceKind;
  label: string | null;
  text: string;
};

export type ExtractedPassage = {
  /** 画像に設問文が写っていなければ空文字 */
  instruction: string;
  /** 本文の段落の後ろに、選択肢の段落を続けて並べる */
  paragraphs: ExtractedRow[][];
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
画像は問題の順に並んでいます。日本語の設問文、英文の本文（空所を含む）、選択肢を、それぞれ取り出してください。

設問文（instruction）
- 本文の前にある、解答の仕方を指示する日本語の文を、原文のまま写してください。
- 問題番号（「(B)」など）は含めないでください。
- 紙面の幅で折り返された改行は取り除き、続けて1行にしてください。
- 設問文が写っていない場合は空文字にしてください。

本文（paragraphs）
- 英文の本文を段落ごとに分け、各段落を文と空所の並び（items）にしてください。
- 文は type を "sentence" にし、text に文を写してください。
- 空所（「( 1 )」のように番号を括弧で囲んだもの）は type を "blank" にし、text に括弧の中の番号だけ（例: "1"）を入れてください。
${
  kind === "paragraph_insertion"
    ? "- この問題では空所に段落が入ります。空所は、空所1つだけを items に持つ1つの段落にしてください。"
    : "- この問題では空所に文が入ります。空所は、それが置かれている段落の中の、文の位置に入れてください。"
}
- 設問文、問題番号、注（語注）、ページ番号、出典表記、選択肢は含めないでください。
- 段落の区切りは原文の段落に合わせてください。画像をまたぐ段落は1つの段落として扱います。
- 画像同士で同じ部分が重なって写っている場合は、重複させずに1回だけ含めてください。
- 文の区切りは文末の終止符・疑問符・感嘆符で判断します。Mr. / Dr. / U.S. / e.g. などの略語や、小数点、引用符の内側にある句点では区切らないでください。

選択肢（choices）
- 本文の後ろにある選択肢を、出題の順に1つずつ取り出してください。
- label には記号だけ（例: "a"）を入れ、括弧や「)」は含めないでください。
- text には選択肢の英文を、記号を除いて写してください。選択肢が複数の文からなる場合も、1つの text にまとめてください。

共通
- 行末のハイフネーションで分かれた単語は元の1語に戻してください。それ以外の綴りや語句は、誤りに見えても原文のまま写してください。
- 前後の空白は取り除き、文中の改行は半角スペース1つにしてください。`;

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
      request(zodTextFormat(extractionSchema, "passage"), SUMMARY_INSTRUCTIONS),
    );
    const parsed = checkResponse(response);
    const paragraphs = parsed.paragraphs
      .map((p) =>
        p.sentences
          .map(normalizeSpaces)
          .filter(Boolean)
          .map((text) => ({ kind: "sentence" as const, label: null, text })),
      )
      .filter((p) => p.length > 0);
    if (paragraphs.length === 0) {
      throw new Error("本文を見つけられませんでした。");
    }
    return { instruction: parsed.instruction.trim(), paragraphs };
  }

  const response = await client.responses.parse(
    request(
      zodTextFormat(insertionSchema, "passage"),
      insertionInstructions(kind),
    ),
  );
  const parsed = checkResponse(response);
  const passage = parsed.paragraphs
    .map((p) =>
      p.items.flatMap((item): ExtractedRow[] => {
        const text = normalizeSpaces(item.text);
        if (!text) return [];
        return item.type === "blank"
          ? [{ kind: "blank", label: text, text: "" }]
          : [{ kind: "sentence", label: null, text }];
      }),
    )
    .filter((p) => p.length > 0);
  if (!passage.some((p) => p.some((r) => r.kind === "sentence"))) {
    throw new Error("本文を見つけられませんでした。");
  }
  const choices = parsed.choices
    .map((c) => ({
      label: normalizeSpaces(c.label),
      text: normalizeSpaces(c.text),
    }))
    .filter((c) => c.text);
  if (choices.length === 0) {
    throw new Error("選択肢を見つけられませんでした。");
  }
  const choiceParagraphs: ExtractedRow[][] =
    kind === "paragraph_insertion"
      ? choices.map((c) => [
          { kind: "choice", label: c.label || null, text: c.text },
        ])
      : // 文挿入では一覧をまとめて読む時間を記録するので、一覧全体を1行にする
        [
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
  return {
    instruction: parsed.instruction.trim(),
    paragraphs: [...passage, ...choiceParagraphs],
  };
}

/** 途中で止まった応答や拒否を例外にして、構造化出力を取り出す */
function checkResponse<T>(response: {
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
  output: ReadonlyArray<
    | { type: "message"; content: ReadonlyArray<{ type: string }> }
    | { type: string }
  >;
  output_parsed: T | null;
}): T {
  if (response.status === "incomplete") {
    throw new Error(
      response.incomplete_details?.reason === "max_output_tokens"
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
  return parsed;
}
