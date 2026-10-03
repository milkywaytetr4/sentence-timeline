import type { Role } from "@/lib/domain/types";

/**
 * ロール入りの署名付き cookie。値は `role.expiresAt.signature` の形で、
 * HMAC-SHA256 で署名する。proxy（middleware）とサーバーの両方から使うため Web Crypto だけで書く。
 */

export const SESSION_COOKIE = "st_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 180;

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function importKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(
  role: Role,
  secret: string,
  now: number = Date.now(),
): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + SESSION_MAX_AGE_SEC;
  const payload = `${role}.${expiresAt}`;
  const sig = await crypto.subtle.sign(
    "HMAC",
    await importKey(secret),
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(sig)}`;
}

export async function verifySession(
  token: string | undefined,
  secret: string | undefined,
  now: number = Date.now(),
): Promise<Role | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [role, exp, sig] = parts;
  if (role !== "teacher" && role !== "student") return null;
  const expiresAt = Number(exp);
  if (!Number.isInteger(expiresAt) || expiresAt * 1000 <= now) return null;
  const sigBytes = fromBase64Url(sig);
  if (!sigBytes) return null;
  // subtle.verify は定数時間で比較する
  const ok = await crypto.subtle.verify(
    "HMAC",
    await importKey(secret),
    sigBytes,
    encoder.encode(`${role}.${exp}`),
  );
  return ok ? role : null;
}
