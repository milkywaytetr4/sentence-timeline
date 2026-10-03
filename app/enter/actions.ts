"use server";

import { redirect } from "next/navigation";
import { roleForPassphrase, setSessionCookie } from "@/lib/server/auth";

export type EnterState = { error: string | null };

/** 入場後の遷移先は同じサイト内のパスに限る（外部URLへのリダイレクトに使われないように） */
function safeNext(next: FormDataEntryValue | null): string | null {
  if (typeof next !== "string") return null;
  if (
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  ) {
    return null;
  }
  return next;
}

export async function enter(
  _prev: EnterState,
  formData: FormData,
): Promise<EnterState> {
  const passphrase = formData.get("passphrase");
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    return { error: "合言葉を入力してください。" };
  }
  const role = roleForPassphrase(passphrase);
  if (!role) return { error: "合言葉が違います。" };

  await setSessionCookie(role);
  redirect(safeNext(formData.get("next")) ?? "/");
}
