import { describe, expect, it } from "vitest";
import { SESSION_MAX_AGE_SEC, signSession, verifySession } from "./session";

const SECRET = "x".repeat(40);
const NOW = Date.UTC(2026, 9, 1);

describe("セッション cookie", () => {
  it("署名したロールを検証で取り出せる", async () => {
    const token = await signSession("teacher", SECRET, NOW);
    expect(await verifySession(token, SECRET, NOW)).toBe("teacher");
  });

  it("ロールを書き換えた値は無効になる", async () => {
    const token = await signSession("student", SECRET, NOW);
    const forged = token.replace(/^student/, "teacher");
    expect(await verifySession(forged, SECRET, NOW)).toBeNull();
  });

  it("別の秘密鍵で署名した値は無効になる", async () => {
    const token = await signSession("teacher", "y".repeat(40), NOW);
    expect(await verifySession(token, SECRET, NOW)).toBeNull();
  });

  it("有効期限を過ぎた値は無効になる", async () => {
    const token = await signSession("teacher", SECRET, NOW);
    const later = NOW + (SESSION_MAX_AGE_SEC + 1) * 1000;
    expect(await verifySession(token, SECRET, later)).toBeNull();
  });

  it("形式の崩れた値や秘密鍵の未設定は無効になる", async () => {
    expect(await verifySession("teacher", SECRET, NOW)).toBeNull();
    expect(await verifySession("admin.9999999999.abc", SECRET, NOW)).toBeNull();
    expect(await verifySession(undefined, SECRET, NOW)).toBeNull();
    const token = await signSession("teacher", SECRET, NOW);
    expect(await verifySession(token, undefined, NOW)).toBeNull();
  });
});
