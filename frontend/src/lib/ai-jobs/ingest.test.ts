import { describe, expect, it } from "vitest";

import type { ExportBundle } from "./build";
import { ingestResults, toSuggestionsBundle } from "./ingest";
import { JOBS_KIND, JOB_RESULTS_KIND, type AiJobBundle, type AiJobResultBundle } from "./types";

const exported: ExportBundle = {
  kind: "snacksbudget.export",
  schema_version: 1,
  scope: "working_set",
  categories: [{ id: "c1", name: "Dining", group: "Fun", is_income: false }],
  transactions: [
    { id: "t1", date: null, amount: null, payee_id: null, payee: null, category_id: null, notes: null },
    { id: "t2", date: null, amount: null, payee_id: null, payee: null, category_id: null, notes: null },
  ],
  examples: [],
};

const bundle: AiJobBundle = {
  kind: JOBS_KIND,
  schemaVersion: 1,
  createdAt: "2026-08-02T00:00:00Z",
  jobs: [
    {
      id: "j1",
      feature: "categorize_transaction",
      system: "s",
      prompt: "p",
      meta: { transactionIds: ["t1", "t2"] },
    },
  ],
};

const results = (output: unknown, model = "qwen"): AiJobResultBundle => ({
  kind: JOB_RESULTS_KIND,
  schemaVersion: 1,
  results: [{ id: "j1", output, model }],
});

describe("ingestResults", () => {
  it("maps a well-formed result to suggestions", () => {
    const report = ingestResults(
      exported,
      bundle,
      results([{ transaction_id: "t1", category_id: "c1" }]),
    );
    expect(report.suggestions).toEqual([
      { transaction_id: "t1", category_id: "c1", source: "lm:qwen" },
    ]);
    expect(report.rejected).toBe(0);
  });

  it.each([
    ["a wrapped array", { suggestions: [{ transaction_id: "t1", category_id: "c1" }] }],
    ["a JSON string", JSON.stringify([{ transaction_id: "t1", category_id: "c1" }])],
  ])("recovers from %s", (_label, output) => {
    // Models wrap or stringify output even under a strict schema.
    const report = ingestResults(exported, bundle, results(output));
    expect(report.suggestions).toHaveLength(1);
  });

  it("drops hallucinated transaction ids", () => {
    const report = ingestResults(
      exported,
      bundle,
      results([{ transaction_id: "does-not-exist", category_id: "c1" }]),
    );
    expect(report.suggestions).toHaveLength(0);
    expect(report.rejected).toBe(1);
    expect(report.warnings.join(" ")).toContain("unknown transactions");
  });

  it("drops category ids that aren't in the export", () => {
    const report = ingestResults(
      exported,
      bundle,
      results([{ transaction_id: "t1", category_id: "Dining Out" }]),
    );
    expect(report.suggestions).toHaveLength(0);
    expect(report.rejected).toBe(1);
  });

  it("ignores answers outside the job's own scope", () => {
    // One job must not be able to answer for another batch's transactions.
    const scoped: AiJobBundle = {
      ...bundle,
      jobs: [{ ...bundle.jobs[0], meta: { transactionIds: ["t1"] } }],
    };
    const report = ingestResults(
      exported,
      scoped,
      results([{ transaction_id: "t2", category_id: "c1" }]),
    );
    expect(report.suggestions).toHaveLength(0);
  });

  it("lets history-settled entries win over model output", () => {
    const report = ingestResults(
      exported,
      bundle,
      results([{ transaction_id: "t1", category_id: "c1" }]),
      [
        {
          transaction_id: "t1",
          category_id: "c1",
          confidence: 1,
          reason: "history",
          source: "history",
        },
      ],
    );
    expect(report.suggestions).toHaveLength(1);
    expect(report.suggestions[0].source).toBe("history");
  });

  it("reports failed and missing jobs", () => {
    const report = ingestResults(exported, bundle, {
      kind: JOB_RESULTS_KIND,
      schemaVersion: 1,
      results: [{ id: "j1", error: "timed out" }],
    });
    expect(report.failed).toBe(1);
    expect(report.warnings.join(" ")).toContain("failed");
  });

  it("survives garbage output without throwing", () => {
    for (const junk of [null, 42, "not json", {}, [1, 2, 3]]) {
      expect(() => ingestResults(exported, bundle, results(junk))).not.toThrow();
    }
  });
});

describe("toSuggestionsBundle", () => {
  it("wraps suggestions in the envelope the API expects", () => {
    const out = toSuggestionsBundle([{ transaction_id: "t1", category_id: "c1" }]);
    expect(out.kind).toBe("snacksbudget.suggestions");
    expect(out.schema_version).toBe(1);
    expect(out.categorizations).toHaveLength(1);
  });
});
