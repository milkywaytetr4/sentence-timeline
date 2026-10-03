import { describe, expect, it } from "vitest";
import { formatDate } from "./format";

describe("formatDate", () => {
  it("日本時間の日付を「9月28日」の形で表す", () => {
    expect(formatDate("2026-09-27T16:00:00Z")).toBe("9月28日");
    expect(formatDate("2026-09-28T14:59:59Z")).toBe("9月28日");
  });
});
