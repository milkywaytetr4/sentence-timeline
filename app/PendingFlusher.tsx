"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { flushAllPending } from "@/lib/client/useEventSync";

/** 計測画面で送り切れなかった記録を送り、送れたら一覧を最新にする */
export function PendingFlusher() {
  const router = useRouter();
  useEffect(() => {
    void flushAllPending().then((sent) => {
      if (sent) router.refresh();
    });
  }, [router]);
  return null;
}
