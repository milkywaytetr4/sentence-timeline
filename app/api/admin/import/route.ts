import { NextResponse } from "next/server";
import { z } from "zod";
import {
  detectImageType,
  MAX_IMAGES,
  MAX_TOTAL_IMAGE_BYTES,
} from "@/lib/domain/image";
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
});

/** スクリーンショットを受け取り、private バケットに保存してから本文を抽出し、問題として登録する */
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

  const files = form
    .getAll("images")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "画像を選んでください。" },
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
    passage = await extractPassage(images);
  } catch (e) {
    console.error("extract failed", e);
    const message =
      e instanceof Error ? e.message : "本文を抽出できませんでした。";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const sentences = passage.paragraphs.flatMap((list, p) =>
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
    p_source_path: folder,
    p_sentences: sentences,
    // 読み取れなかったときは null にして、列の既定値（要約問題の文言）を入れる
    p_instruction: passage.instruction || null,
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
