import { describe, it, expect } from "vitest";
import {
  parseCategorizeSuggestions,
  parseFsaStructured,
  parseJsonResponse,
  demoStructuredResult,
} from "./contracts";

describe("contracts parsers", () => {
  it("parses FSA eligible object", () => {
    const raw = parseJsonResponse('{"eligible": [{"index": 0, "confidence": "high", "fsa_category": "Rx", "reason": "pharmacy"}]}');
    const out = parseFsaStructured(raw);
    expect(out.eligible).toHaveLength(1);
    expect(out.eligible[0]!.index).toBe(0);
  });

  it("parses categorize root array", () => {
    const raw = parseJsonResponse('[{"transaction_id": "t1", "category_id": "c1"}]');
    const out = parseCategorizeSuggestions(raw);
    expect(out).toEqual([{ transaction_id: "t1", category_id: "c1" }]);
  });

  it("demo FSA returns empty eligible", () => {
    const raw = demoStructuredResult("fsa_review");
    expect(parseFsaStructured(raw).eligible).toEqual([]);
  });
});
