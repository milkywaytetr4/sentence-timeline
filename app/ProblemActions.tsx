"use client";

import { Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { deleteAttempt, startAttempt } from "./actions";

export function StartButton({
  problemId,
  disabled,
}: {
  problemId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    // 開始時刻はタップした瞬間の端末時刻にする（通信の遅れを計測に混ぜない）
    const clientTs = new Date().toISOString();
    const eventId = crypto.randomUUID();
    setError(null);
    startTransition(async () => {
      const res = await startAttempt({ problemId, eventId, clientTs });
      if ("error" in res) setError(res.error);
      else router.push(`/attempts/${res.attemptId}`);
    });
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        size="lg"
        icon={Play}
        onClick={onClick}
        disabled={disabled || pending}
      >
        {pending ? "準備しています…" : "新しく解く"}
      </Button>
      {error && (
        <span role="alert" className="text-[12px] text-(--red-500)">
          {error}
        </span>
      )}
    </span>
  );
}

export function ResumeLink({ attemptId }: { attemptId: string }) {
  return (
    <Link
      href={`/attempts/${attemptId}`}
      className="inline-flex h-9 items-center rounded-full px-3 text-[14px] font-semibold text-(--text-link) hover:bg-(--sky-200) hover:no-underline"
    >
      続きから
    </Link>
  );
}

export function DeleteAttemptButton({
  attemptId,
  label,
}: {
  attemptId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label={`${label}を削除`}
      title="削除"
      disabled={pending}
      onClick={() => {
        if (
          !window.confirm(
            `${label}の記録を削除します。元に戻せません。よろしいですか。`,
          )
        ) {
          return;
        }
        startTransition(() => deleteAttempt(attemptId));
      }}
      className="inline-flex size-9 items-center justify-center rounded-full text-(--text-tertiary) hover:bg-(--red-100) hover:text-(--red-500) disabled:opacity-40"
    >
      <Trash2 size={18} aria-hidden />
    </button>
  );
}
