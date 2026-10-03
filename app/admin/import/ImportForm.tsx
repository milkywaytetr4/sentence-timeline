"use client";

import { FileCheck, FileUp, ScanText } from "lucide-react";
import { useRouter } from "next/navigation";
import { type DragEvent, type FormEvent, useRef, useState } from "react";
import { Button } from "@/components/ui";

export function ImportForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) {
      setError("PDF を選んでください。");
      return;
    }
    const form = new FormData(e.currentTarget);
    form.set("pdf", file);
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
        className="flex h-[180px] flex-col items-center justify-center gap-2.5 rounded-(--radius-20) border-[1.5px] border-dashed text-(--text-secondary) transition-[background,border-color] duration-(--dur-fast)"
        style={{
          borderColor: dragging ? "var(--sky-500)" : "var(--border-strong)",
          background: dragging ? "var(--sky-200)" : "var(--surface-tint)",
        }}
      >
        {file ? (
          <FileCheck size={32} aria-hidden />
        ) : (
          <FileUp size={32} aria-hidden />
        )}
        <span className="text-[14px] font-semibold">
          {file ? file.name : "スキャンPDFをここにドロップ"}
        </span>
        <span className="text-[14px] text-(--text-link)">
          {file ? "別のファイルを選ぶ" : "ファイルを選ぶ"}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

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
