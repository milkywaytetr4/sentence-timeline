"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { type QueueOp, queueOpSchema } from "@/lib/domain/wire";

/**
 * 送信待ちのイベントを端末（localStorage）に保持し、まとめてサーバーへ送る。
 * 送信に成功した分だけキューから外すので、通信が切れても記録は失われない。
 */

const storageKey = (attemptId: string) => `st-queue:${attemptId}`;
const BATCH_LIMIT = 500;
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

// localStorage が使えない環境（プライベートブラウズなど）では、タブを閉じるまでメモリに持つ
const memoryFallback = new Map<string, QueueOp[]>();

export function loadQueue(attemptId: string): QueueOp[] {
  try {
    const raw = window.localStorage.getItem(storageKey(attemptId));
    if (!raw) return memoryFallback.get(attemptId) ?? [];
    const parsed = z.array(queueOpSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return memoryFallback.get(attemptId) ?? [];
  }
}

function saveQueue(attemptId: string, ops: QueueOp[]) {
  memoryFallback.set(attemptId, ops);
  try {
    if (ops.length === 0) window.localStorage.removeItem(storageKey(attemptId));
    else
      window.localStorage.setItem(storageKey(attemptId), JSON.stringify(ops));
  } catch {
    // メモリ側には保持済み
  }
}

export type SyncStatus = "idle" | "sending" | "retrying" | "unauthorized";

export function useEventSync(attemptId: string) {
  const [pendingCount, setPendingCount] = useState(0);
  const [status, setStatus] = useState<SyncStatus>("idle");
  const inFlight = useRef(false);
  const backoff = useRef(MIN_BACKOFF_MS);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(
    async (opts?: { keepalive?: boolean }): Promise<void> => {
      if (inFlight.current) return;
      const ops = loadQueue(attemptId);
      setPendingCount(ops.length);
      if (ops.length === 0) {
        setStatus("idle");
        return;
      }
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;

      const batch = ops.slice(0, BATCH_LIMIT);
      inFlight.current = true;
      setStatus("sending");
      let retryAfter: number | null = null;
      try {
        const res = await fetch(`/api/attempts/${attemptId}/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ops: batch }),
          keepalive: opts?.keepalive,
        });
        if (res.status === 401) {
          setStatus("unauthorized");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // 送信中に追加された分は残す
        const rest = loadQueue(attemptId).slice(batch.length);
        saveQueue(attemptId, rest);
        setPendingCount(rest.length);
        backoff.current = MIN_BACKOFF_MS;
        setStatus("idle");
        if (rest.length > 0) retryAfter = 0;
      } catch {
        setStatus("retrying");
        retryAfter = backoff.current;
        backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
      } finally {
        inFlight.current = false;
      }
      if (retryAfter !== null) {
        retryTimer.current = setTimeout(() => void flush(), retryAfter);
      }
    },
    [attemptId],
  );

  const enqueue = useCallback(
    (op: QueueOp) => {
      const next = [...loadQueue(attemptId), op];
      saveQueue(attemptId, next);
      setPendingCount(next.length);
      void flush();
    },
    [attemptId, flush],
  );

  useEffect(() => {
    void flush();
    const onOnline = () => {
      backoff.current = MIN_BACKOFF_MS;
      void flush();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden")
        void flush({ keepalive: true });
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onHide);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [flush]);

  return { enqueue, flush, pendingCount, status };
}

/**
 * 端末に残っている全取り組みの未送信分を送る。計測画面を閉じたあとに残った分を、
 * 一覧画面を開いたときに拾うために使う。送れた取り組みがあれば true を返す。
 */
export async function flushAllPending(): Promise<boolean> {
  let keys: string[] = [];
  try {
    keys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith("st-queue:"),
    );
  } catch {
    return false;
  }
  let sent = false;
  for (const key of keys) {
    const attemptId = key.slice("st-queue:".length);
    const batch = loadQueue(attemptId).slice(0, BATCH_LIMIT);
    if (batch.length === 0) continue;
    try {
      const res = await fetch(`/api/attempts/${attemptId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ops: batch }),
      });
      if (res.status === 404) {
        // 取り組みが削除済みなら、送り先がないので端末からも消す
        saveQueue(attemptId, []);
        continue;
      }
      if (!res.ok) continue;
      saveQueue(attemptId, loadQueue(attemptId).slice(batch.length));
      sent = true;
    } catch {
      // 次に一覧を開いたときに再送する
    }
  }
  return sent;
}
