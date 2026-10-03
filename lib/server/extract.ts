import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { ImageType } from "@/lib/domain/image";
import { normalizeSpaces } from "@/lib/domain/text";
import { serverEnv } from "./env";

const extractionSchema = z.object({
  paragraphs: z.array(
    z.object({
      sentences: z.array(z.string()),
    }),
  ),
});

export type ExtractedParagraphs = string[][];

export type SourceImage = { bytes: Buffer; type: ImageType };

const INSTRUCTIONS = `これらの画像は東京大学の入試問題、英語 第1問(A)（要約問題）のスクリーンショットです。
画像は本文の順に並んでいます。英文の本文だけを取り出し、段落ごと・文ごとに分けてください。

- 日本語の設問文、問題番号、注（語注）、ページ番号、出典表記は含めないでください。
- 段落の区切りは原文の段落に合わせてください。画像をまたぐ段落は1つの段落として扱います。
- 画像同士で同じ部分が重なって写っている場合は、重複させずに1回だけ含めてください。
- 文の区切りは文末の終止符・疑問符・感嘆符で判断します。Mr. / Dr. / U.S. / e.g. などの略語や、小数点、引用符の内側にある句点では区切らないでください。
- 行末のハイフネーションで分かれた単語は元の1語に戻してください。それ以外の綴りや語句は、誤りに見えても原文のまま写してください。
- 各文の前後の空白は取り除き、文中の改行は半角スペース1つにしてください。`;

export const EXTRACT_UNAVAILABLE_MESSAGE =
  "OPENAI_API_KEY が未設定のため、画像から本文を抽出できません。";

/** 本文抽出に必要な API キーが設定されているか */
export function canExtract(): boolean {
  return Boolean(serverEnv().OPENAI_API_KEY);
}

/**
 * スクリーンショットから英文本文を抽出し、段落×文の配列で返す。
 * 抽出結果は必ず人が編集画面で確認する前提なので、ここでは形だけを検証する。
 */
export async function extractPassage(
  images: SourceImage[],
): Promise<ExtractedParagraphs> {
  const apiKey = serverEnv().OPENAI_API_KEY;
  if (!apiKey) throw new Error(EXTRACT_UNAVAILABLE_MESSAGE);
  const client = new OpenAI({ apiKey });

  const response = await client.responses.parse({
    model: "gpt-6-luna",
    max_output_tokens: 16000,
    reasoning: { effort: "medium" },
    text: { format: zodTextFormat(extractionSchema, "passage") },
    input: [
      {
        role: "user",
        content: [
          ...images.map((image) => ({
            type: "input_image" as const,
            // 小さな文字を読み落とさないよう、縮小の少ない high にする
            detail: "high" as const,
            image_url: `data:${image.type.mime};base64,${image.bytes.toString("base64")}`,
          })),
          { type: "input_text", text: INSTRUCTIONS },
        ],
      },
    ],
  });

  if (response.status === "incomplete") {
    throw new Error(
      response.incomplete_details?.reason === "max_output_tokens"
        ? "本文が長すぎて抽出が途中で終わりました。"
        : "抽出が途中で止まりました。画像の内容を確認してください。",
    );
  }
  const refused = response.output.some(
    (item) =>
      item.type === "message" &&
      item.content.some((part) => part.type === "refusal"),
  );
  if (refused) {
    throw new Error("LLM が抽出を断りました。画像の内容を確認してください。");
  }
  const parsed = response.output_parsed;
  if (!parsed) throw new Error("LLM の出力を読み取れませんでした。");

  const paragraphs = parsed.paragraphs
    .map((p) => p.sentences.map(normalizeSpaces).filter(Boolean))
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) {
    throw new Error("本文を見つけられませんでした。");
  }
  return paragraphs;
}
