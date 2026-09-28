import { describe, it, expect } from "vitest";
import { isReadableFile } from "./document-text";

const file = (type: string) => new File(["x"], "doc", { type });

describe("isReadableFile", () => {
  it("accepts a PDF and any image", () => {
    expect(isReadableFile(file("application/pdf"))).toBe(true);
    expect(isReadableFile(file("image/jpeg"))).toBe(true);
    expect(isReadableFile(file("image/png"))).toBe(true);
    expect(isReadableFile(file("image/heic"))).toBe(true);
  });

  it("rejects what the readers cannot open", () => {
    expect(isReadableFile(file("text/csv"))).toBe(false);
    expect(isReadableFile(file("application/zip"))).toBe(false);
    expect(isReadableFile(file(""))).toBe(false);
  });
});
