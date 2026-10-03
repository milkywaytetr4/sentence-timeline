import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  signSession,
  verifySession,
} from "@/lib/auth/session";
import type { Role } from "@/lib/domain/types";
import { serverEnv } from "./env";

export async function getRole(): Promise<Role | null> {
  const store = await cookies();
  return verifySession(
    store.get(SESSION_COOKIE)?.value,
    serverEnv().SESSION_SECRET,
  );
}

/** ページと Server Action の冒頭で呼ぶ。未入場なら入場画面へ送る */
export async function requireRole(): Promise<Role> {
  const role = await getRole();
  if (!role) redirect("/enter");
  return role;
}

export async function requireTeacher(): Promise<Role> {
  const role = await requireRole();
  if (role !== "teacher") redirect("/");
  return role;
}

function sameSecret(input: string, expected: string): boolean {
  // 長さの違いで早期に抜けないよう、ハッシュをとってから定数時間で比較する
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function roleForPassphrase(input: string): Role | null {
  const env = serverEnv();
  // 両方と比較してから判定し、どちらに一致したかで処理時間が変わらないようにする
  const teacher = sameSecret(input, env.TEACHER_PASSPHRASE);
  const student = sameSecret(input, env.STUDENT_PASSPHRASE);
  if (teacher) return "teacher";
  if (student) return "student";
  return null;
}

export async function setSessionCookie(role: Role) {
  const store = await cookies();
  store.set(
    SESSION_COOKIE,
    await signSession(role, serverEnv().SESSION_SECRET),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SEC,
    },
  );
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
