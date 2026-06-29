import { describe, expect, it, vi } from "vitest";
import type { CapabilitySnapshot, LLMProvider } from "../types";
import type { PipelineContext } from "./types";

vi.mock("./steps", async (orig) => {
  const mod = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...mod,
    ground: vi.fn().mockResolvedValue({
      goals: [
        {
          goal_id: "g1",
          name: "Emergency fund",
          target_amount: 6000,
          current_amount: 1200,
          monthly_contribution: 400,
          months_remaining: 12,
        },
        {
          goal_id: "g2",
          name: "New car",
          target_amount: 10000,
          current_amount: 2000,
          monthly_contribution: 500,
          months_remaining: 16,
        },
      ],
    }),
  };
});

import { runGoalPipeline } from "./goal";

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

describe("runGoalPipeline", () => {
  it("accepts a plan whose goal exists and arithmetic reconciles", async () => {
    // (6000 - 1200) / 400 = 12 months → in range.
    const out =
      '{"plan":{"goal_id":"g1","monthly_contribution":400,"months_to_target":12,"note":"steady"}}';
    const result = await runGoalPipeline(ctx(out));
    expect(result.plan.goal_id).toBe("g1");
  });

  it("rejects a fabricated goal_id", async () => {
    const out =
      '{"plan":{"goal_id":"ghost","monthly_contribution":400,"months_to_target":12,"note":"x"}}';
    await expect(runGoalPipeline(ctx(out))).rejects.toMatchObject({
      code: "verify_failed",
    });
  });

  it("rejects an arithmetic mismatch (months_to_target way off)", async () => {
    // Expected ~12 months, model claims 2 → outside ±1.
    const out =
      '{"plan":{"goal_id":"g1","monthly_contribution":400,"months_to_target":2,"note":"x"}}';
    await expect(runGoalPipeline(ctx(out))).rejects.toMatchObject({
      code: "verify_failed",
    });
  });

  it("plans the requested goal when goalId is provided", async () => {
    // (10000 - 2000) / 500 = 16 months → in range for g2.
    const out =
      '{"plan":{"goal_id":"g2","monthly_contribution":500,"months_to_target":16,"note":"steady"}}';
    const result = await runGoalPipeline(ctx(out), { goalId: "g2" });
    expect(result.plan.goal_id).toBe("g2");
  });

  it("rejects a plan for a different goal than the requested goalId", async () => {
    // Target g2, but the model returns an otherwise-valid plan for g1.
    const out =
      '{"plan":{"goal_id":"g1","monthly_contribution":400,"months_to_target":12,"note":"steady"}}';
    await expect(
      runGoalPipeline(ctx(out), { goalId: "g2" }),
    ).rejects.toMatchObject({
      code: "verify_failed",
    });
  });
});
