import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { TopBar } from "@/components/ui";
import { requireTeacher } from "@/lib/server/auth";
import { ImportForm } from "./ImportForm";

export default async function ImportPage() {
  await requireTeacher();
  return (
    <div className="dot-bg flex min-h-dvh flex-col">
      <TopBar>
        <Link
          href="/"
          aria-label="一覧へ"
          title="一覧へ"
          className="inline-flex size-11 flex-none items-center justify-center rounded-[10px] text-(--text-tertiary) hover:bg-(--surface-chip)"
        >
          <ChevronLeft size={22} aria-hidden />
        </Link>
        <span className="text-[18px] font-semibold whitespace-nowrap">
          問題の取り込み
        </span>
      </TopBar>
      <main className="p-4 sm:p-7">
        <ImportForm />
      </main>
    </div>
  );
}
