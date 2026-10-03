import { NextResponse } from "next/server";
import { z } from "zod";
import { countWords } from "@/lib/domain/text";
import { getRole } from "@/lib/server/auth";
import { db, PDF_BUCKET } from "@/lib/server/db";
import {
  canExtract,
  EXTRACT_UNAVAILABLE_MESSAGE,
  extractPassage,
} from "@/lib/server/extract";

// LLM による抽出は1分前後かかる
export const maxDuration = 300;

// Vercel の関数はリクエスト本文が 4.5MB までなので、それより小さく抑える
const MAX_PDF_BYTES = 4 * 1024 * 1024;

const metaSchema = z.object({
  title: z.string().trim().min(1, "タイトルを入力してください").max(200),
  year: z.string().trim().max(40),
  questionNo: z.string().trim().max(40),
});

/** スキャンPDFを受け取り、private バケットに保存してから本文を抽出し、問題として登録する */
export async function POST(request: Request) {
  const role = await getRole();
  if (role !== "teacher") {
    return NextResponse.json(
      { error: "先生だけが取り込めます。" },
      { status: 403 },
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form)
    return NextResponse.json(
      { error: "フォームを読み取れません。" },
      { status: 400 },
    );

  const meta = metaSchema.safeParse({
    title: form.get("title"),
    year: form.get("year") ?? "",
    questionNo: form.get("questionNo") ?? "",
  });
  if (!meta.success) {
    return NextResponse.json(
      { error: meta.error.issues[0]?.message },
      { status: 400 },
    );
  }

  const file = form.get("pdf");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "PDF を選んでください。" },
      { status: 400 },
    );
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      {
        error:
          "PDF は4MBまでにしてください。解像度を下げてスキャンし直すと小さくなります。",
      },
      { status: 413 },
    );
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  // 拡張子や Content-Type は偽れるので、ファイル先頭のシグネチャで判定する
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return NextResponse.json(
      { error: "PDF ファイルではありません。" },
      { status: 400 },
    );
  }

  // 抽出できないと分かっている PDF を Storage に残さないよう、保存より前に確かめる
  if (!canExtract()) {
    return NextResponse.json(
      { error: EXTRACT_UNAVAILABLE_MESSAGE },
      { status: 503 },
    );
  }

  const path = `${crypto.randomUUID()}.pdf`;
  const upload = await db()
    .storage.from(PDF_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf" });
  if (upload.error) {
    console.error("pdf upload failed", upload.error);
    return NextResponse.json(
      { error: "PDF を保存できませんでした。" },
      { status: 500 },
    );
  }

  let paragraphs: string[][];
  try {
    paragraphs = await extractPassage(bytes);
  } catch (e) {
    console.error("extract failed", e);
    const message =
      e instanceof Error ? e.message : "本文を抽出できませんでした。";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const sentences = paragraphs.flatMap((list, p) =>
    list.map((text, s) => ({
      id: null,
      paragraph_index: p,
      sentence_index: s,
      text,
      word_count: countWords(text),
    })),
  );

  const { data, error } = await db().rpc("save_problem", {
    p_problem_id: null,
    p_title: meta.data.title,
    p_year: meta.data.year,
    p_question_no: meta.data.questionNo,
    p_source_pdf_path: path,
    p_sentences: sentences,
  });
  if (error) {
    console.error("save_problem failed", error);
    return NextResponse.json(
      { error: "問題を保存できませんでした。" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data as string });
}
