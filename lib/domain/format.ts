// サーバーとブラウザで表示がずれないよう、タイムゾーンを固定し、書式は自前で組み立てる
// （ja-JP の既定書式は実行環境によって「9/28」にも「9月28日」にもなるため）
const dateParts = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Tokyo",
});

/** 「9月28日」の形 */
export function formatDate(iso: string): string {
  const parts = dateParts.formatToParts(new Date(iso));
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${month}月${day}日`;
}
