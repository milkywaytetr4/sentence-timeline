import { describe, expect, it } from "vitest";
import { detectImageType } from "./image";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("detectImageType", () => {
  it("PNG のシグネチャを PNG と判定する", () => {
    expect(
      detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)),
    ).toEqual({ mime: "image/png", ext: "png" });
  });

  it("JPEG のシグネチャを JPEG と判定する", () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({
      mime: "image/jpeg",
      ext: "jpg",
    });
  });

  it("PDF や GIF は受け付けない", () => {
    expect(detectImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("GIF89a"))).toBeNull();
  });

  it("シグネチャより短いデータは受け付けない", () => {
    expect(detectImageType(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(detectImageType(bytes())).toBeNull();
  });
});
