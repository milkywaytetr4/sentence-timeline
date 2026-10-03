"use client";

import { KeyRound } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui";
import { type EnterState, enter } from "./actions";

export function EnterForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<EnterState, FormData>(enter, {
    error: null,
  });

  return (
    <form
      action={action}
      className="frame flex w-[400px] max-w-full flex-col gap-4 p-9"
    >
      <h1 className="m-0 text-[24px] leading-[1.4] font-bold tracking-(--ls-display)">
        1a 読解タイムライン
      </h1>
      <p className="m-0 text-[14px] leading-[1.7] text-(--text-secondary)">
        合言葉を入力してください。
      </p>
      <label className="relative flex items-center">
        <span className="sr-only">合言葉</span>
        <KeyRound
          size={18}
          aria-hidden
          className="pointer-events-none absolute left-3.5 text-(--text-placeholder)"
        />
        <input
          name="passphrase"
          type="password"
          autoComplete="current-password"
          required
          className="field h-[52px]! pl-10!"
        />
      </label>
      <input type="hidden" name="next" value={next} />
      {state.error && (
        <p role="alert" className="m-0 text-[14px] text-(--red-500)">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {pending ? "確認しています…" : "入る"}
      </Button>
    </form>
  );
}
