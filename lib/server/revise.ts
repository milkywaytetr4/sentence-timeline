import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { countChars } from "@/lib/domain/text";
import type { Sentence } from "@/lib/domain/types";
import { serverEnv } from "./env";

// 前のフィールドから順に生成されるので、本文の構造を分析し、解答とのずれを診断してから改稿させる。
// 分析と診断は画面に出さないので保存もしない
const reviseSchema = z.object({
  paragraphs: z.array(
    z.object({
      paragraph: z.number(),
      role: z.string(),
      point: z.string(),
    }),
  ),
  thesis: z.string(),
  logic: z.string(),
  diagnosis: z.array(z.string()),
  revised: z.string(),
});

const INSTRUCTIONS = `あなたは東京大学の入試問題、英語 第1問(A)（要約問題）を指導する予備校講師です。
設問文・英文の本文・受験者の解答を読み、受験者の解答を、本文の論理構造を正しく写した要約に改稿してください。
改稿した解答は、先生と生徒が元の解答と比べて議論する材料として使います。
次の順に考え、各項目を出力してください。

1. 段落の構造（paragraphs）
- 段落ごとに、文章全体の中での役割（問題提起、通説の紹介、反論、具体例、主張、結論など）と、その段落の要点を書いてください。
- 要点は、トピックセンテンス（段落の主題を述べる文）を手がかりにしてください。具体例や言い換えにあたる段落は、どの要点を支えているかを書いてください。

2. 筆者の主張（thesis）
- 文章全体で筆者がいちばん言いたいことを1文で書いてください。通説や他者の見解と区別してください。

3. 要点どうしの論理関係（logic）
- 解答に入れるべき要点を選び、それらが「譲歩→主張」「通説→反論」「原因→結果」「問題→解決」などのどの関係で結びついているかを書いてください。
- 要約に入れる要点と、入れない要点（具体例、補足）を分けてください。

4. 受験者の解答の診断（diagnosis）
- 1〜3の分析と受験者の解答を比べ、ずれを1項目ずつ書いてください。見る観点は次のとおりです。
  - 筆者の主張が、解答の中心（多くは文末）に置かれているか
  - 必要な要点が抜けていないか、要らない具体例に字数を使っていないか
  - 接続（「が」「ものの」「ため」「ので」「一方」など）が、本文の論理関係と合っているか。譲歩の後には主張が、原因の後には結果が続いているか
  - 本文の趣旨と食い違う内容がないか、日本語として不自然な箇所がないか

5. 改稿（revised）
- 診断で挙げたずれをすべて直してください。最優先は、3の論理関係が接続の言葉と文の組み立てに正しく表れていることです。
- そのうえで、受験者の書き口（語彙の選び方、言い回し）をできるだけ残してください。論理を正すために必要なら、要点の順序や文の組み立ては変えて構いません。
- 字数の指示がある場合は、空白を除いた文字数で指示の範囲に収めてください。受験者の解答の字数は与えられた値を正としてください。
- 書き終えたら、改稿だけを読んで本文を知らない人にも筋が通るか、各接続が3の論理関係と一致しているかを確かめ、合わなければ直してから出力してください。
- 解答の文だけを書き、解説は付けないでください。`;

export const REVISE_UNAVAILABLE_MESSAGE =
  "OPENAI_API_KEY が未設定のため、解答を改稿できません。";

/** 段落の構造を分析させるので、段落ごとに番号を振って並べる */
function formatPassage(sentences: Sentence[]): string {
  const paragraphs = new Map<number, string[]>();
  for (const s of sentences) {
    const list = paragraphs.get(s.paragraphIndex) ?? [];
    list.push(s.text);
    paragraphs.set(s.paragraphIndex, list);
  }
  return [...paragraphs.values()]
    .map((texts, i) => `[第${i + 1}段落]\n${texts.join(" ")}`)
    .join("\n\n");
}

/** 設問文・本文・受験者の解答を LLM に渡し、本文の論理構造に沿うよう改稿した解答を返す */
export async function reviseAnswer({
  instruction,
  sentences,
  answer,
}: {
  instruction: string;
  sentences: Sentence[];
  answer: string;
}): Promise<string> {
  const apiKey = serverEnv().OPENAI_API_KEY;
  if (!apiKey) throw new Error(REVISE_UNAVAILABLE_MESSAGE);
  const client = new OpenAI({ apiKey });

  // LLM は日本語の字数を数え間違えやすいので、こちらで数えた値を渡す
  const input = `設問文
${instruction}

本文
${formatPassage(sentences)}

受験者の解答（空白を除いて${countChars(answer)}字）
${answer}`;

  const response = await client.responses.parse({
    model: "gpt-6-luna",
    // 推論と分析の出力も上限に含まれるので、抽出より多めにとる
    max_output_tokens: 32000,
    // 論理構造の分析と書き直しの確かめまでさせるので、抽出より深く考えさせる
    reasoning: { effort: "high" },
    instructions: INSTRUCTIONS,
    text: { format: zodTextFormat(reviseSchema, "revision") },
    input,
  });

  if (response.status === "incomplete") {
    throw new Error("改稿が途中で止まりました。もう一度お試しください。");
  }
  const refused = response.output.some(
    (item) =>
      item.type === "message" &&
      item.content.some((part) => part.type === "refusal"),
  );
  if (refused) throw new Error("LLM が改稿を断りました。");
  const revised = response.output_parsed?.revised.trim();
  if (!revised) throw new Error("LLM の出力を読み取れませんでした。");
  return revised;
}
