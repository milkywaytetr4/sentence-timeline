"use client";

import { FileText, ImagePlus, ScanText, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { Button, IconButton, Tabs } from "@/components/ui";
import { shrinkImage } from "@/lib/client/shrinkImage";
import { MAX_IMAGES, MAX_TOTAL_IMAGE_BYTES } from "@/lib/domain/image";
import { PROBLEM_KIND_LABEL, type ProblemKind } from "@/lib/domain/types";

const ACCEPTED_TYPES = ["image/png", "image/jpeg"];

const PROBLEM_KINDS = Object.keys(PROBLEM_KIND_LABEL) as ProblemKind[];

const DEFAULT_QUESTION_NO: Record<ProblemKind, string> = {
  summary: "1(A)",
  paragraph_insertion: "1(B)",
  sentence_insertion: "1(B)",
};

type Picked = { id: string; file: File; url: string };

type Source = "image" | "text";

const SOURCES: { value: Source; label: string }[] = [
  { value: "image", label: "画像から" },
  { value: "text", label: "テキストから" },
];

export function ImportForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source>("image");
  const [images, setImages] = useState<Picked[]>([]);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ProblemKind>("summary");
  const [questionNo, setQuestionNo] = useState(DEFAULT_QUESTION_NO.summary);

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
    if (source !== "image") return;
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
    const form = new FormData(e.currentTarget);
    form.delete("images");
    if (source === "text") {
      if (!text.trim()) {
        setError("本文を貼り付けてください。");
        return;
      }
    } else {
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
      form.delete("text");
      for (const p of images) form.append("images", p.file);
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        truncated?: boolean;
        error?: string;
      };
      if (!res.ok || !body.id) {
        setError(body.error ?? "取り込みに失敗しました。");
        return;
      }
      router.push(
        `/admin/problems/${body.id}${body.truncated ? "?truncated=1" : ""}`,
      );
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
      <Tabs
        items={SOURCES}
        value={source}
        onChange={(v) => {
          setSource(v);
          setError(null);
        }}
      />

      {source === "text" && (
        <label className="flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary)">
          本文
          <textarea
            name="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder={
              "段落の間は空行で区切ります。\n空所は ( 1 ) のように番号を括弧で囲み、\n選択肢は a) のように記号で始めて本文の後ろに並べます。"
            }
            className="field h-auto! resize-y py-2.5! text-[15px] leading-[1.7]"
          />
        </label>
      )}

      {source === "image" && (
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
      )}
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

      {source === "image" && images.length > 0 && (
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
        <label className="col-span-2 flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary) sm:col-span-3">
          種類
          <select
            name="kind"
            value={kind}
            onChange={(e) => {
              const next = e.target.value as ProblemKind;
              setKind(next);
              // 大問の欄を書き換えていなければ、種類に合わせた既定値にそろえる
              setQuestionNo((q) =>
                q === DEFAULT_QUESTION_NO[kind] ? DEFAULT_QUESTION_NO[next] : q,
              );
            }}
            className="field"
          >
            {PROBLEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {PROBLEM_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary)">
          年度
          <input name="year" placeholder="2024 / 練習" className="field" />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] font-medium text-(--text-secondary)">
          大問
          <input
            name="questionNo"
            value={questionNo}
            onChange={(e) => setQuestionNo(e.target.value)}
            className="field"
          />
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
        {source === "image" ? (
          <>
            <Button type="submit" size="lg" icon={ScanText} disabled={pending}>
              {pending ? "抽出しています…" : "本文を抽出する"}
            </Button>
            <span className="text-[12px] font-medium text-(--text-tertiary)">
              {pending
                ? "1分ほどかかります。この画面のままお待ちください。"
                : "抽出後、編集画面で文と段落の区切りを確認します。"}
            </span>
          </>
        ) : (
          <>
            <Button type="submit" size="lg" icon={FileText} disabled={pending}>
              {pending ? "取り込んでいます…" : "本文を取り込む"}
            </Button>
            <span className="text-[12px] font-medium text-(--text-tertiary)">
              LLM
              を使わずに文へ分けます。取り込み後、編集画面で区切りを確認します。
            </span>
          </>
        )}
      </div>
    </form>
  );
}
