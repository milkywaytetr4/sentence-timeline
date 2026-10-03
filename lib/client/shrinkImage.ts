/** これより大きい画像は送信前に JPEG へ変換する */
const SHRINK_THRESHOLD_BYTES = 1024 * 1024;
const JPEG_QUALITY = 0.9;

/**
 * 大きなスクリーンショットを JPEG に変換して小さくする。
 * 小さい文字の読み取り精度を落とさないよう、解像度はそのまま保つ（縮小はしない）。
 * 変換しても小さくならなければ元のファイルを返す。
 */
export async function shrinkImage(file: File): Promise<File> {
  if (file.size <= SHRINK_THRESHOLD_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // PNG の透明部分が黒くならないよう、白で塗ってから描く
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.\w+$/, "") || "image";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
