import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
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

const INSTRUCTIONS = `この PDF は東京大学の入試問題、英語 第1問(A)（要約問題）のスキャンです。
英文の本文だけを取り出し、段落ごと・文ごとに分けてください。

- 日本語の設問文、問題番号、注（語注）、ページ番号、出典表記は含めないでください。
- 段落の区切りは原文の段落に合わせてください。ページをまたぐ段落は1つの段落として扱います。
- 文の区切りは文末の終止符・疑問符・感嘆符で判断します。Mr. / Dr. / U.S. / e.g. などの略語や、小数点、引用符の内側にある句点では区切らないでください。
- 行末のハイフネーションで分かれた単語は元の1語に戻してください。それ以外の綴りや語句は、誤りに見えても原文のまま写してください。
- 各文の前後の空白は取り除き、文中の改行は半角スペース1つにしてください。`;

export const EXTRACT_UNAVAILABLE_MESSAGE =
  "ANTHROPIC_API_KEY が未設定のため、PDF から本文を抽出できません。";

/** 本文抽出に必要な API キーが設定されているか */
export function canExtract(): boolean {
  return Boolean(serverEnv().ANTHROPIC_API_KEY);
}

/**
 * スキャンPDFから英文本文を抽出し、段落×文の配列で返す。
 * 抽出結果は必ず人が編集画面で確認する前提なので、ここでは形だけを検証する。
 */
export async function extractPassage(
  pdf: Buffer,
): Promise<ExtractedParagraphs> {
  const apiKey = serverEnv().ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error(EXTRACT_UNAVAILABLE_MESSAGE);
  const client = new Anthropic({ apiKey });

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // 安全分類器に誤って断られた場合は、サーバー側で推奨モデルに切り替えて再試行させる
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(extractionSchema),
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdf.toString("base64"),
            },
          },
          { type: "text", text: INSTRUCTIONS },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("LLM が抽出を断りました。PDF の内容を確認してください。");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("本文が長すぎて抽出が途中で終わりました。");
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("LLM の出力を読み取れませんでした。");

  const paragraphs = parsed.paragraphs
    .map((p) => p.sentences.map(normalizeSpaces).filter(Boolean))
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) {
    throw new Error("本文を見つけられませんでした。");
  }
  return paragraphs;
}
