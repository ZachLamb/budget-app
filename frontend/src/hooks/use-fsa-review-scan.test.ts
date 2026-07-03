import { describe, it, expect } from "vitest";
import { buildEligibleFromBatches } from "./use-fsa-review-scan";

type Row = Parameters<typeof buildEligibleFromBatches>[0][number];

function cand(id: string): Row {
  return {
    transaction_id: id,
    date: "2026-06-01",
    payee_name: "P",
    category_name: "C",
    amount: 10,
    status: "pending",
  } as Row;
}

describe("buildEligibleFromBatches", () => {
  it("maps indexes to the correct candidate slice when an earlier batch fails", () => {
    const candidates = [cand("a"), cand("b"), cand("c"), cand("d")];
    const out = buildEligibleFromBatches(candidates, 2, [
      null, // batch 0 failed — must NOT shift batch 1's mapping
      { eligible: [{ index: 1, confidence: "high", fsa_category: "Rx", reason: "r" }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.transaction_id).toBe("d");
  });
});
