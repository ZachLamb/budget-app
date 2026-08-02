import { describe, expect, it } from "vitest";

import {
  JOBS_KIND,
  JOB_RESULTS_KIND,
  isJobResultBundle,
  reconcileResults,
  type AiJobBundle,
  type AiJobResultBundle,
} from "./types";

const bundle: AiJobBundle = {
  kind: JOBS_KIND,
  schemaVersion: 1,
  createdAt: "2026-08-02T00:00:00Z",
  jobs: [
    { id: "a", feature: "categorize_transaction", system: "s", prompt: "p" },
    { id: "b", feature: "categorize_transaction", system: "s", prompt: "p" },
  ],
};

const results = (r: AiJobResultBundle["results"]): AiJobResultBundle => ({
  kind: JOB_RESULTS_KIND,
  schemaVersion: 1,
  results: r,
});

describe("isJobResultBundle", () => {
  it("accepts a well-formed bundle", () => {
    expect(isJobResultBundle(results([]))).toBe(true);
  });

  it.each([null, undefined, 42, "x", {}, { kind: JOBS_KIND, schemaVersion: 1, results: [] }])(
    "rejects %s",
    (value) => {
      expect(isJobResultBundle(value)).toBe(false);
    },
  );

  it("rejects a bundle whose results are not an array", () => {
    expect(
      isJobResultBundle({ kind: JOB_RESULTS_KIND, schemaVersion: 1, results: {} }),
    ).toBe(false);
  });
});

describe("reconcileResults", () => {
  it("pairs results with their jobs", () => {
    const out = reconcileResults(bundle, results([{ id: "a", output: { x: 1 } }]));
    expect(out.matched).toHaveLength(1);
    expect(out.matched[0].job.id).toBe("a");
    expect(out.missing.map((j) => j.id)).toEqual(["b"]);
  });

  it("reports ids that were never issued rather than dropping them", () => {
    // A hand-edited or mismatched file shouldn't fail silently.
    const out = reconcileResults(bundle, results([{ id: "ghost", output: {} }]));
    expect(out.unknown).toEqual(["ghost"]);
    expect(out.matched).toHaveLength(0);
  });

  it("separates failed jobs from successful ones", () => {
    const out = reconcileResults(
      bundle,
      results([
        { id: "a", output: { x: 1 } },
        { id: "b", error: "timed out" },
      ]),
    );
    expect(out.matched.map((m) => m.job.id)).toEqual(["a"]);
    expect(out.failed.map((f) => f.id)).toEqual(["b"]);
    expect(out.missing).toHaveLength(0);
  });

  it("accounts for every job when results are empty", () => {
    const out = reconcileResults(bundle, results([]));
    expect(out.missing).toHaveLength(2);
  });
});
