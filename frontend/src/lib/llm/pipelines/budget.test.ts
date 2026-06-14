import { describe, expect, it, vi } from "vitest";
import type { CapabilitySnapshot, LLMProvider } from "../types";
import type { PipelineContext } from "./types";

vi.mock("./steps", async (orig) => {
  const mod = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...mod,
    ground: vi.fn().mockResolvedValue({
      month: "2026-06",
      categories: [
        {
          category_id: "c1",
          name: "Dining",
          budgeted: 200,
          actual: 350,
          remaining: -150,
        },
      ],
      total_budgeted: 200,
      total_actual: 350,
    }),
  };
});

import { runBudgetPipeline } from "./budget";

const capability: CapabilitySnapshot = {
  nano: { available: true, status: "available" },
  webgpu: { available: false, modelSize: "none" },
  specialized: {
    summarizer: false,
    writer: false,
    rewriter: false,
    proofreader: false,
  },
};

function ctx(out: string): PipelineContext {
  const provider: LLMProvider = {
    name: "nano",
    tier: 1,
    privacy: "local",
    async *generate() {
      yield out;
    },
  };
  return { provider, capability };
}

describe("runBudgetPipeline", () => {
  it("accepts a recommendation whose category exists and amount is in range", async () => {
    const out =
      '{"recommendations":[{"category_id":"c1","suggested_amount":300,"rationale":"trim dining"}]}';
    const result = await runBudgetPipeline(ctx(out));
    expect(result.recommendations[0].category_id).toBe("c1");
  });

  it("rejects a recommendation citing a non-existent category (verify_failed after retries)", async () => {
    const out =
      '{"recommendations":[{"category_id":"ghost","suggested_amount":300,"rationale":"x"}]}';
    await expect(runBudgetPipeline(ctx(out))).rejects.toMatchObject({
      code: "verify_failed",
    });
  });
});
