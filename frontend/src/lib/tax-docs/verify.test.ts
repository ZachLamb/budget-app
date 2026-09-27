import { describe, it, expect } from "vitest";
import { numberAppearsIn, verifyQuotedFields } from "./verify";

describe("numberAppearsIn", () => {
  it("matches a figure written with separators", () => {
    expect(numberAppearsIn(154692, "11 Adjusted gross income 154,692")).toBe(true);
  });

  it("matches a figure written with cents", () => {
    expect(numberAppearsIn(44844, "24 Total tax 44,844.00")).toBe(true);
  });

  it("rejects a figure that is not in the line at all", () => {
    expect(numberAppearsIn(99999, "24 Total tax 44,844")).toBe(false);
  });

  it("does not accept a different number that merely shares digits", () => {
    expect(numberAppearsIn(448, "24 Total tax 44,844")).toBe(false);
  });
});

describe("verifyQuotedFields", () => {
  const KEYS = ["a", "b"] as const;
  const LABELS = { a: "Figure A", b: "Figure B" };
  const DOC = "line one: 100 line two: 250";

  it("keeps a figure quoted from the document", () => {
    const r = verifyQuotedFields(
      { a: { value: 100, source_text: "line one: 100" } },
      KEYS,
      LABELS,
      DOC,
    );
    expect(r.fields.a).toEqual({ value: 100, sourceText: "line one: 100" });
    expect(r.missing).toEqual(["b"]);
  });

  it("ignores case and spacing differences in the quote", () => {
    const r = verifyQuotedFields(
      { a: { value: 100, source_text: "  LINE   ONE: 100 " } },
      KEYS,
      LABELS,
      DOC,
    );
    expect(r.fields.a?.value).toBe(100);
  });

  it("names the field in plain words when it rejects one", () => {
    const r = verifyQuotedFields(
      { a: { value: 100, source_text: "a line that is not there" } },
      KEYS,
      LABELS,
      DOC,
    );
    expect(r.rejections[0]).toMatch(/^Figure A: /);
  });

  it("treats a bare number with no quote as unusable", () => {
    const r = verifyQuotedFields({ a: 100 }, KEYS, LABELS, DOC);
    expect(r.fields.a).toBeUndefined();
    expect(r.rejections.join(" ")).toContain("did not say where");
  });
});
