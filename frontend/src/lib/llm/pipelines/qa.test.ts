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

import { runQaPipeline } from "./qa";

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

describe("runQaPipeline", () => {
  it("accepts a non-empty answer citing only real fact ids", async () => {
    const out =
      '{"answer":"You overspent on dining.","cited_facts":["c1"]}';
    const result = await runQaPipeline(ctx(out), {
      question: "How am I doing on dining?",
    });
    expect(result.answer).toMatch(/dining/i);
    expect(result.cited_facts).toEqual(["c1"]);
  });

  it("rejects hallucinated citations (verify_failed)", async () => {
    const out =
      '{"answer":"Looks fine.","cited_facts":["ghost"]}';
    await expect(
      runQaPipeline(ctx(out), { question: "How am I doing?" }),
    ).rejects.toMatchObject({ code: "verify_failed" });
  });

  it("rejects an empty answer (verify_failed)", async () => {
    const out = '{"answer":"   ","cited_facts":[]}';
    await expect(
      runQaPipeline(ctx(out), { question: "How am I doing?" }),
    ).rejects.toMatchObject({ code: "verify_failed" });
  });
});
