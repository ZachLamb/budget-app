import { describe, expect, it } from "vitest";
import { buildQaPrompt, buildQaSystem, renderSearchMatches } from "./qa-prompt";

const MATCH = {
  kind: "category",
  id: "c-1",
  name: "Foreign Transaction Fees",
  this_month: 7.75,
  last_month: 3.25,
  three_month_total: 11.0,
  txn_count: 2,
};

describe("qa prompt builders", () => {
  it("system prompt forbids inventing numbers", () => {
    expect(buildQaSystem()).toMatch(/only the provided facts/i);
    expect(buildQaSystem()).toMatch(/never (invent|compute)/i);
  });
  it("renders search matches with exact amounts", () => {
    const text = renderSearchMatches([MATCH]);
    expect(text).toContain("Foreign Transaction Fees");
    expect(text).toContain("7.75");
  });
  it("prompt includes question, ids, facts, and matches", () => {
    const p = buildQaPrompt("how much?", ["c-1"], '{"x":1}', [MATCH]);
    expect(p).toContain("how much?");
    expect(p).toContain("c-1");
    expect(p).toContain('{"x":1}');
    expect(p).toContain("7.75");
  });
  it("omits the matches section when empty", () => {
    expect(buildQaPrompt("q", [], "{}", [])).not.toMatch(/matching records/i);
  });
});
