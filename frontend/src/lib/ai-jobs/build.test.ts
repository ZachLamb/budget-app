import { describe, expect, it } from "vitest";

import { JOB_BATCH_SIZE, buildJobBundle, type ExportBundle } from "./build";
import { JOBS_KIND } from "./types";

const categories = [
  { id: "c-coffee", name: "Dining Out", group: "Fun", is_income: false },
  { id: "c-rent", name: "Rent", group: "Bills", is_income: false },
];

const txn = (id: string, payee: string | null, categoryId: string | null = null) => ({
  id,
  date: "2026-08-01",
  amount: -5,
  payee_id: payee ? `p-${payee}` : null,
  payee,
  category_id: categoryId,
  notes: null,
});

const exported = (over: Partial<ExportBundle> = {}): ExportBundle => ({
  kind: "snacksbudget.export",
  schema_version: 1,
  scope: "working_set",
  categories,
  transactions: [],
  examples: [],
  ...over,
});

describe("buildJobBundle", () => {
  it("produces a valid, empty bundle when there is nothing to do", () => {
    const { bundle, settled } = buildJobBundle(exported());
    expect(bundle.kind).toBe(JOBS_KIND);
    expect(bundle.jobs).toHaveLength(0);
    expect(settled).toHaveLength(0);
  });

  it("settles a transaction whose payee history is consistent", () => {
    const result = buildJobBundle(
      exported({
        transactions: [txn("t-new", "Blue Bottle")],
        examples: [
          txn("t1", "Blue Bottle", "c-coffee"),
          txn("t2", "blue bottle", "c-coffee"),
          txn("t3", "BLUE BOTTLE", "c-coffee"),
        ],
      }),
    );
    expect(result.settled).toHaveLength(1);
    expect(result.settled[0]).toMatchObject({
      transaction_id: "t-new",
      category_id: "c-coffee",
      source: "history",
    });
    // Settled work must not also be sent to the model.
    expect(result.bundle.jobs).toHaveLength(0);
  });

  it("does not settle when history disagrees", () => {
    const result = buildJobBundle(
      exported({
        transactions: [txn("t-new", "Amazon")],
        examples: [
          txn("t1", "Amazon", "c-coffee"),
          txn("t2", "Amazon", "c-rent"),
        ],
      }),
    );
    expect(result.settled).toHaveLength(0);
    expect(result.bundle.jobs).toHaveLength(1);
  });

  it("does not settle on a single prior sighting", () => {
    // One example is a coincidence, not a pattern.
    const result = buildJobBundle(
      exported({
        transactions: [txn("t-new", "Blue Bottle")],
        examples: [txn("t1", "Blue Bottle", "c-coffee")],
      }),
    );
    expect(result.settled).toHaveLength(0);
  });

  it("ignores history pointing at a category that no longer exists", () => {
    const result = buildJobBundle(
      exported({
        transactions: [txn("t-new", "Ghost")],
        examples: [txn("t1", "Ghost", "c-deleted"), txn("t2", "Ghost", "c-deleted")],
      }),
    );
    expect(result.settled).toHaveLength(0);
    expect(result.bundle.jobs).toHaveLength(1);
  });

  it("can be told to send everything to the model", () => {
    const result = buildJobBundle(
      exported({
        transactions: [txn("t-new", "Blue Bottle")],
        examples: [
          txn("t1", "Blue Bottle", "c-coffee"),
          txn("t2", "Blue Bottle", "c-coffee"),
        ],
      }),
      { settleFromHistory: false },
    );
    expect(result.settled).toHaveLength(0);
    expect(result.bundle.jobs).toHaveLength(1);
  });

  it("splits large workloads into batches", () => {
    const transactions = Array.from({ length: JOB_BATCH_SIZE * 2 + 1 }, (_, i) =>
      txn(`t${i}`, `Payee ${i}`),
    );
    const { bundle } = buildJobBundle(exported({ transactions }));
    expect(bundle.jobs).toHaveLength(3);
    expect(bundle.jobs[0].meta?.transactionIds).toHaveLength(JOB_BATCH_SIZE);
  });

  it("gives each job the category list and a response schema", () => {
    const { bundle } = buildJobBundle(
      exported({ transactions: [txn("t1", "Somewhere")] }),
    );
    const job = bundle.jobs[0];
    expect(job.prompt).toContain("c-coffee");
    expect(job.responseSchema).toBeDefined();
    expect(job.feature).toBe("categorize_transaction");
  });
});
