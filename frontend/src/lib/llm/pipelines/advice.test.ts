import { describe, expect, it, vi } from "vitest";
import type { CapabilitySnapshot, LLMProvider } from "../types";
import type { PipelineContext } from "./types";

vi.mock("./steps", async (orig) => {
  const mod = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...mod,
    ground: vi.fn().mockResolvedValue({
      net_worth: 5000,
      accounts: [{ account_id: "a1", name: "Checking", balance: 5000 }],
      recent_spend_by_category: [
        { category_id: "c1", name: "Dining", amount: 350 },
      ],
      budget: {
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
      },
      goals: [{ goal_id: "g1", name: "Emergency fund" }],
    }),
  };
});

import { ADVICE_DISCLAIMER, runAdvicePipeline } from "./advice";

const capability: CapabilitySnapshot = {
  nano: { available: true, status: "available" },
  webgpu: { available: false, modelSize: "none" },
  server: { available: true },
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

describe("runAdvicePipeline", () => {
  it("accepts advice that only uses numbers present in the facts and always sets the fixed disclaimer", async () => {
    const out = JSON.stringify({
      advice: "You spent 350 on dining against a 200 budget; trim it.",
      basis: ["c1"],
      disclaimer: "model tried to write its own disclaimer",
    });
    const result = await runAdvicePipeline(ctx(out), {
      question: "How is my dining spend?",
    });
    expect(result.disclaimer).toBe(ADVICE_DISCLAIMER);
    expect(result.draft).toBe(true);
    expect(result.basis).toEqual(["c1"]);
  });

  it("rejects advice that introduces a fabricated number (verify_failed)", async () => {
    const out = JSON.stringify({
      advice: "You should save $999 more each month.",
      basis: ["c1"],
      disclaimer: "x",
    });
    await expect(
      runAdvicePipeline(ctx(out), { question: "What should I do?" }),
    ).rejects.toMatchObject({ code: "verify_failed" });
  });

  it("rejects advice citing an unknown basis fact (verify_failed)", async () => {
    const out = JSON.stringify({
      advice: "Looks fine.",
      basis: ["ghost"],
      disclaimer: "x",
    });
    await expect(
      runAdvicePipeline(ctx(out), { question: "What should I do?" }),
    ).rejects.toMatchObject({ code: "verify_failed" });
  });
});
