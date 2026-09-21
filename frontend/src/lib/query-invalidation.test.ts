import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateTransactionDerived, TRANSACTION_DERIVED_KEYS } from "./query-invalidation";

function keysInvalidatedBy(fn: (qc: QueryClient) => void): string[] {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries").mockImplementation(() => Promise.resolve());
  fn(qc);
  return spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
}

describe("invalidateTransactionDerived", () => {
  it("invalidates the Dashboard's budget and spending keys", () => {
    const keys = keysInvalidatedBy(invalidateTransactionDerived);
    // The exact keys the Dashboard renders from — the ones that used to go stale.
    for (const k of ['["budget"]', '["spending-by-category"]', '["spending-by-month"]', '["cycle-summary"]']) {
      expect(keys).toContain(k);
    }
  });

  it("still covers what the Transactions page already invalidated", () => {
    const keys = keysInvalidatedBy(invalidateTransactionDerived);
    expect(keys).toContain('["transactions"]');
    expect(keys).toContain('["accounts"]');
  });

  it("does not invalidate the user-maintained recurring list", () => {
    // Derived data only — ["recurring"] is edited by hand, not computed.
    expect(keysInvalidatedBy(invalidateTransactionDerived)).not.toContain('["recurring"]');
  });

  it("uses prefixes so month-scoped keys are covered", () => {
    // ["budget"] must cover ["budget","2026-09"]; a full key would not.
    for (const k of TRANSACTION_DERIVED_KEYS) expect(k.length).toBe(1);
  });

  it("has no duplicate entries", () => {
    const flat = TRANSACTION_DERIVED_KEYS.map((k) => k.join("/"));
    expect(new Set(flat).size).toBe(flat.length);
  });
});
