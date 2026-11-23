import { NextResponse } from "next/server";
import { z } from "zod";
import {
  detectImageType,
  MAX_IMAGES,
  MAX_TOTAL_IMAGE_BYTES,
} from "@/lib/domain/image";
import { parsePassageText } from "@/lib/domain/passage";
import { defaultQuestions, questionRow } from "@/lib/domain/question";
import { countWords } from "@/lib/domain/text";
import { getRole } from "@/lib/server/auth";
import { db, IMAGE_BUCKET } from "@/lib/server/db";
import {
  canExtract,
  EXTRACT_UNAVAILABLE_MESSAGE,
  type ExtractedPassage,
  extractPassage,
  type SourceImage,
} from "@/lib/server/extract";

// LLM による抽出は1分前後かかる
export const maxDuration = 300;

const metaSchema = z.object({
  title: z.string().trim().min(1, "タイトルを入力してください").max(200),
  year: z.string().trim().max(40),
  questionNo: z.string().trim().max(40),
  kind: z.enum(["summary", "paragraph_insertion", "sentence_insertion"]),
});

/**
 * スクリーンショットを受け取り、private バケットに保存してから本文を抽出し、問題として登録する。
 * 画像の代わりに本文のテキストを受け取ったときは、LLM を使わずに分割して登録する。
 */
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
    kind: form.get("kind") ?? "summary",
  });
  if (!meta.success) {
    return NextResponse.json(
      { error: meta.error.issues[0]?.message },
      { status: 400 },
    );
  }

  const text = form.get("text");
  if (typeof text === "string" && text.trim()) {
    const paragraphs = parsePassageText(text, meta.data.kind);
    if (!paragraphs.some((p) => p.some((r) => r.kind === "sentence"))) {
      return NextResponse.json(
        { error: "本文を見つけられませんでした。" },
        { status: 400 },
      );
    }
    // 小問の設問文と語群は、貼り付けた文面からは本文と確実に見分けられないので、編集画面で入力してもらう
    return saveImported(meta.data, null, {
      instruction: "",
      paragraphs,
      questions: defaultQuestions(meta.data.kind),
      truncated: false,
    });
  }

  const files = form
    .getAll("images")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "画像を選ぶか、本文を貼り付けてください。" },
      { status: 400 },
    );
  }
  if (files.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `画像は${MAX_IMAGES}枚までにしてください。` },
      { status: 400 },
    );
  }
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "画像は合計4MBまでにしてください。" },
      { status: 413 },
    );
  }

  const images: SourceImage[] = [];
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    // 拡張子や Content-Type は偽れるので、ファイル先頭のシグネチャで判定する
    const type = detectImageType(bytes);
    if (!type) {
      return NextResponse.json(
        { error: `${file.name} は PNG / JPEG の画像ではありません。` },
        { status: 400 },
      );
    }
    images.push({ bytes, type });
  }

  // 抽出できないと分かっている画像を Storage に残さないよう、保存より前に確かめる
  if (!canExtract()) {
    return NextResponse.json(
      { error: EXTRACT_UNAVAILABLE_MESSAGE },
      { status: 503 },
    );
  }

  // 1回の取り込み分を1つのフォルダにまとめ、画像の順番はファイル名の連番で残す
  const folder = crypto.randomUUID();
  const paths = images.map(
    (image, i) => `${folder}/${i + 1}.${image.type.ext}`,
  );
  const uploads = await Promise.all(
    images.map((image, i) =>
      db()
        .storage.from(IMAGE_BUCKET)
        .upload(paths[i], image.bytes, { contentType: image.type.mime }),
    ),
  );
  const failed = uploads.find((u) => u.error);
  if (failed) {
    console.error("image upload failed", failed.error);
    await db().storage.from(IMAGE_BUCKET).remove(paths);
    return NextResponse.json(
      { error: "画像を保存できませんでした。" },
      { status: 500 },
    );
  }

  let passage: ExtractedPassage;
  try {
    passage = await extractPassage(images, meta.data.kind);
  } catch (e) {
    console.error("extract failed", e);
    // 問題として登録しない画像は、どこからも参照されないので消す
    await db().storage.from(IMAGE_BUCKET).remove(paths);
    const message =
      e instanceof Error ? e.message : "本文を抽出できませんでした。";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return saveImported(meta.data, { folder, paths }, passage);
}

async function saveImported(
  meta: z.infer<typeof metaSchema>,
  /** 画像から取り込んだときの保存先。テキストから取り込んだときは null */
  source: { folder: string; paths: string[] } | null,
  passage: ExtractedPassage,
) {
  const sentences = passage.paragraphs.flatMap((list, p) =>
    list.map((row, s) => ({
      id: null,
      paragraph_index: p,
      sentence_index: s,
      kind: row.kind,
      label: row.label,
      text: row.text,
      word_count: countWords(row.text),
    })),
  );

  const { data, error } = await db().rpc("save_problem", {
    p_problem_id: null,
    p_title: meta.title,
    p_year: meta.year,
    p_question_no: meta.questionNo,
    p_source_path: source?.folder ?? null,
    p_sentences: sentences,
    // 要約問題で読み取れなかったときは null にして、列の既定値（要約問題の文言）を入れる
    p_instruction: passage.instruction || (meta.kind === "summary" ? null : ""),
    p_kind: meta.kind,
    p_questions: passage.questions.map(questionRow),
  });
  if (error) {
    console.error("save_problem failed", error);
    if (source) await db().storage.from(IMAGE_BUCKET).remove(source.paths);
    return NextResponse.json(
      { error: "問題を保存できませんでした。" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: data as string,
    truncated: passage.truncated,
  });
}
