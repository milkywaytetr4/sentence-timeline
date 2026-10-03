import { EnterForm } from "./EnterForm";

export default async function EnterPage({ searchParams }: PageProps<"/enter">) {
  const { next } = await searchParams;
  return (
    <main className="dot-bg flex min-h-dvh items-center justify-center p-4">
      <EnterForm next={typeof next === "string" ? next : ""} />
    </main>
  );
}
