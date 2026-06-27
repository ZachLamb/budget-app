import { describe, expect, it, vi } from "vitest";
import type { CapabilitySnapshot, LLMProvider } from "../types";
import type { PipelineContext } from "./types";

// Mock only `ground` (by fact path); the real generateVerified/generateStructured/
// verify run so we exercise the retry ladder end to end.
const BUDGET_FACTS = {
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
};
const GOAL_FACTS = {
  goals: [
    {
      goal_id: "g1",
      name: "Emergency fund",
      target_amount: 6000,
      current_amount: 1200,
      monthly_contribution: 400,
      months_remaining: 12,
    },
  ],
};
const CONTEXT_FACTS = {
  net_worth: 5000,
  accounts: [{ account_id: "a1", name: "Checking", balance: 5000 }],
  recent_spend_by_category: [{ category_id: "c1", name: "Dining", amount: 350 }],
  budget: BUDGET_FACTS,
  goals: [{ goal_id: "g1", name: "Emergency fund" }],
};

vi.mock("./steps", async (orig) => {
  const mod = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...mod,
    ground: vi.fn(async (path: string) => {
      if (path.includes("budget")) return BUDGET_FACTS;
      if (path.includes("goal")) return GOAL_FACTS;
      return CONTEXT_FACTS;
    }),
  };
});

import { runBudgetPipeline } from "./budget";
import { runGoalPipeline } from "./goal";
import { runQaPipeline } from "./qa";
import { runAdvicePipeline } from "./advice";

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

/** Yields a different queued output on each generate() call (last one sticks). */
function queueProvider(outputs: string[]): LLMProvider {
  let i = 0;
  return {
    name: "nano",
    tier: 1,
    privacy: "local",
    async *generate() {
      const out = outputs[Math.min(i, outputs.length - 1)];
      i += 1;
      yield out;
    },
  };
}

function ctx(outputs: string[]): PipelineContext {
  return { provider: queueProvider(outputs), capability };
}

describe("budget pipeline — adversarial retry ladder", () => {
  it("recovers across malformed JSON → hallucinated category → valid", async () => {
    const valid =
      '{"recommendations":[{"category_id":"c1","suggested_amount":300,"rationale":"trim dining"}]}';
    const result = await runBudgetPipeline(
      ctx([
        "not json at all", // attempt 0 → schema_parse_failed → retry
        '{"recommendations":[{"category_id":"ghost","suggested_amount":300,"rationale":"x"}]}', // attempt 1 → verify_failed → retry
        valid, // attempt 2 → accepted
      ]),
    );
    expect(result.recommendations[0].category_id).toBe("c1");
  });

  it("surfaces schema_parse_failed when every attempt is malformed", async () => {
    await expect(
      runBudgetPipeline(ctx(["nope", "still nope", "garbage"])),
    ).rejects.toMatchObject({ code: "schema_parse_failed" });
  });

  it("rejects an out-of-range amount on every attempt", async () => {
    const huge =
      '{"recommendations":[{"category_id":"c1","suggested_amount":999999999,"rationale":"x"}]}';
    await expect(runBudgetPipeline(ctx([huge]))).rejects.toMatchObject({
      code: "verify_failed",
    });
  });
});

describe("goal pipeline — adversarial retry ladder", () => {
  it("recovers across malformed → arithmetic mismatch → valid", async () => {
    const valid =
      '{"plan":{"goal_id":"g1","monthly_contribution":400,"months_to_target":12,"note":"steady"}}';
    const result = await runGoalPipeline(
      ctx([
        "{bad", // schema_parse_failed
        '{"plan":{"goal_id":"g1","monthly_contribution":400,"months_to_target":2,"note":"x"}}', // verify_failed (math off)
        valid,
      ]),
    );
    expect(result.plan.months_to_target).toBe(12);
  });
});

describe("qa pipeline — adversarial retry ladder", () => {
  it("recovers across malformed → hallucinated citation → valid", async () => {
    const valid = '{"answer":"You overspent on dining.","cited_facts":["c1"]}';
    const result = await runQaPipeline(
      ctx([
        "not json", // schema_parse_failed
        '{"answer":"x","cited_facts":["ghost"]}', // verify_failed
        valid,
      ]),
      { question: "How am I doing?" },
    );
    expect(result.cited_facts).toEqual(["c1"]);
  });
});

describe("advice pipeline — adversarial retry ladder", () => {
  it("recovers across fabricated number → unknown basis → valid, always sets disclaimer", async () => {
    const valid = JSON.stringify({
      advice: "You spent 350 against a 200 budget.",
      basis: ["c1"],
      disclaimer: "ignored",
    });
    const result = await runAdvicePipeline(
      ctx([
        JSON.stringify({
          advice: "Save $12345 now.",
          basis: ["c1"],
          disclaimer: "x",
        }), // verify_failed (fabricated number)
        JSON.stringify({ advice: "fine", basis: ["ghost"], disclaimer: "x" }), // verify_failed (unknown basis)
        valid,
      ]),
      { question: "What should I do?" },
    );
    expect(result.draft).toBe(true);
    expect(result.disclaimer).toMatch(/not professional financial advice/i);
    expect(result.basis).toEqual(["c1"]);
  });
});
