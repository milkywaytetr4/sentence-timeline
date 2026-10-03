"use client";

import { ImagePlus, ScanText, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { Button, IconButton } from "@/components/ui";
import { shrinkImage } from "@/lib/client/shrinkImage";
import { MAX_IMAGES, MAX_TOTAL_IMAGE_BYTES } from "@/lib/domain/image";

const ACCEPTED_TYPES = ["image/png", "image/jpeg"];

type Picked = { id: string; file: File; url: string };

export function ImportForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = async (files: Iterable<File>) => {
    const list = [...files];
    const accepted = list.filter((f) => ACCEPTED_TYPES.includes(f.type));
    if (accepted.length < list.length) {
      setError("PNG / JPEG の画像だけを追加できます。");
    } else {
      setError(null);
    }
    if (accepted.length === 0) return;
    const shrunk = await Promise.all(accepted.map(shrinkImage));
    const picked = shrunk.map((file) => ({
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
    }));
    setImages((prev) => [...prev, ...picked]);
  };

  const remove = (id: string) => {
    setImages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  // 入力欄にフォーカスがあっても画像だけは拾えるよう、ページ全体で貼り付けを受ける
  const onPaste = useEffectEvent((e: ClipboardEvent) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
  });
  useEffect(() => {
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void addFiles(e.dataTransfer.files);
  };

  const totalBytes = images.reduce((sum, p) => sum + p.file.size, 0);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (images.length === 0) {
      setError("画像を選ぶか、貼り付けてください。");
      return;
    }
    if (images.length > MAX_IMAGES) {
      setError(`画像は${MAX_IMAGES}枚までにしてください。`);
      return;
    }
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      setError("画像は合計4MBまでにしてください。");
      return;
    }
    const form = new FormData(e.currentTarget);
    form.delete("images");
    for (const p of images) form.append("images", p.file);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
      if (!res.ok || !body.id) {
        setError(body.error ?? "取り込みに失敗しました。");
        return;
      }
      router.push(`/admin/problems/${body.id}`);
    } catch {
      setError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="frame flex max-w-[680px] flex-col gap-5 p-5 sm:p-7"
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className="flex h-[160px] flex-col items-center justify-center gap-2.5 rounded-(--radius-20) border-[1.5px] border-dashed text-(--text-secondary) transition-[background,border-color] duration-(--dur-fast)"
        style={{
          borderColor: dragging ? "var(--sky-500)" : "var(--border-strong)",
          background: dragging ? "var(--sky-200)" : "var(--surface-tint)",
        }}
      >
        <ImagePlus size={32} aria-hidden />
        <span className="text-[14px] font-semibold">
          スクリーンショットをドロップ、または Ctrl+V で貼り付け
        </span>
        <span className="text-[14px] text-(--text-link)">ファイルを選ぶ</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files) void addFiles(files);
          // 同じファイルを続けて選び直しても onChange が発火するよう空にする
          e.target.value = "";
        }}
      />

      {images.length > 0 && (
        <div className="flex flex-col gap-2">
          <ol className="m-0 grid list-none grid-cols-3 gap-3 p-0 sm:grid-cols-4">
            {images.map((p, i) => (
              <li
                key={p.id}
                className="relative overflow-hidden rounded-[10px] border border-(--border-strong) bg-(--surface-tint)"
              >
                {/* biome-ignore lint/performance/noImgElement: blob URL のプレビューは next/image の最適化対象外 */}
                <img
                  src={p.url}
                  alt={`${i + 1}枚目`}
                  className="block aspect-[3/4] w-full object-cover object-top"
                />
                <span className="absolute top-1.5 left-1.5 rounded-md bg-(--surface-inverse) px-1.5 py-0.5 text-[12px] font-semibold text-white">
                  {i + 1}
                </span>
                <IconButton
                  icon={X}
                  label={`${i + 1}枚目を外す`}
                  variant="inverse"
                  size={28}
                  className="absolute top-1.5 right-1.5"
                  onClick={() => remove(p.id)}
                />
              </li>
            ))}
          </ol>
          <span className="text-[12px] font-medium text-(--text-tertiary)">
            番号の順に本文として読み取ります（{images.length}/{MAX_IMAGES}
            枚・合計 {(totalBytes / 1024 / 1024).toFixed(1)}MB / 4MB）
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-[130px_130px_minmax(0,1fr)]">
        <label className="flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary)">
          年度
          <input name="year" placeholder="2024 / 練習" className="field" />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary)">
          大問
          <input name="questionNo" defaultValue="1(A)" className="field" />
        </label>
        <label className="col-span-2 flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary) sm:col-span-1">
          タイトル
          <input
            name="title"
            required
            placeholder="時計と時間の標準化"
            className="field"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="m-0 text-[14px] text-(--red-500)">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" icon={ScanText} disabled={pending}>
          {pending ? "抽出しています…" : "本文を抽出する"}
        </Button>
        <span className="text-[12px] font-medium text-(--text-tertiary)">
          {pending
            ? "1分ほどかかります。この画面のままお待ちください。"
            : "抽出後、編集画面で文と段落の区切りを確認します。"}
        </span>
      </div>
    </form>
  );
}
