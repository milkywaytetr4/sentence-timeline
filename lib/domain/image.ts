/** 1回の取り込みで受け付ける画像の枚数 */
export const MAX_IMAGES = 10;
/** 画像の合計サイズ。Vercel の関数はリクエスト本文が 4.5MB までなので、それより小さく抑える */
export const MAX_TOTAL_IMAGE_BYTES = 4 * 1024 * 1024;

export type ImageType = {
  mime: "image/png" | "image/jpeg";
  ext: "png" | "jpg";
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((b, i) => bytes[i] === b)
  );
}

/** ファイル先頭のシグネチャから PNG / JPEG を判定する。どちらでもなければ null */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, PNG_SIGNATURE))
    return { mime: "image/png", ext: "png" };
  if (startsWith(bytes, JPEG_SIGNATURE))
    return { mime: "image/jpeg", ext: "jpg" };
  return null;
}
