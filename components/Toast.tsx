"use client";

import { CircleAlert, CircleCheckBig, X } from "lucide-react";
import Link from "next/link";
import {
  createContext,
  type ReactNode,
  useContext,
  useRef,
  useState,
} from "react";

type ToastInput = {
  tone: "success" | "error";
  title: string;
  body?: string;
  action?: { href: string; label: string };
};
type ToastItem = ToastInput & { id: number };

/** 失敗は対処を読む時間が要るので、成功より長く出す */
const DURATION_MS = { success: 5_000, error: 10_000 } as const;

const TONE = {
  success: { icon: CircleCheckBig, color: "var(--mint-500)" },
  error: { icon: CircleAlert, color: "var(--red-500)" },
} as const;

const ToastContext = createContext<(toast: ToastInput) => void>(() => {});

/** 画面右下に通知を出す。ルートレイアウトに置き、ページを移っても通知が消えないようにする */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  const show = (toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => dismiss(id), DURATION_MS[toast.tone]);
  };

  return (
    <ToastContext value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2.5 sm:right-6 sm:bottom-6"
      >
        {toasts.map((t) => {
          const { icon: Icon, color } = TONE[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="toast-in pointer-events-auto flex items-start gap-3 rounded-(--radius-16) border-[1.5px] border-(--border-subtle) bg-(--surface-card) py-3.5 pr-2 pl-4 shadow-(--shadow-float)"
            >
              <span className="mt-0.5 flex flex-none" style={{ color }}>
                <Icon size={20} aria-hidden />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="text-[15px] leading-[1.5] font-semibold">
                  {t.title}
                </div>
                {t.body && (
                  <div className="text-[13px] leading-[1.6] text-(--text-secondary)">
                    {t.body}
                  </div>
                )}
                {t.action && (
                  <Link
                    href={t.action.href}
                    onClick={() => dismiss(t.id)}
                    className="mt-1 self-start text-[14px] font-semibold"
                  >
                    {t.action.label}
                  </Link>
                )}
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => dismiss(t.id)}
                className="flex size-8 flex-none items-center justify-center rounded-full text-(--text-tertiary) hover:bg-(--surface-chip)"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}

export const useToast = () => useContext(ToastContext);
