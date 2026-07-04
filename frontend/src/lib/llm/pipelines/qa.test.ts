import { describe, expect, it, vi } from "vitest";
import type { CapabilitySnapshot, LLMProvider } from "../types";
import type { PipelineContext } from "./types";

const contextFacts = {
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
};

vi.mock("./steps", async (orig) => {
  const mod = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...mod,
    ground: vi.fn(async (path: string) => {
      if (path.startsWith("/ai/facts/search")) {
        return { query_terms: [], matches: [] };
      }
      return contextFacts;
    }),
    generateVerified: vi.fn(
      async (
        _provider: LLMProvider,
        spec: { prompt: string },
        checks: Array<(r: { answer: string; cited_facts: string[] }) => boolean>,
      ) => {
        const raw = await (async () => {
          for await (const chunk of _provider.generate({
            system: "",
            prompt: spec.prompt,
          })) {
            return chunk;
          }
          return "";
        })();
        const result = JSON.parse(raw) as { answer: string; cited_facts: string[] };
        for (const check of checks) {
          if (!check(result)) {
            const { OnDeviceError } = await import("../errors");
            throw new OnDeviceError("verify_failed", "Verification failed.");
          }
        }
        return result;
      },
    ),
  };
});

import { ground } from "./steps";
import { runQaPipeline } from "./qa";

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

  it("includes search match amounts in the prompt and allows citing match ids", async () => {
    vi.mocked(ground).mockImplementation(async (path: string) => {
      if (path.startsWith("/ai/facts/search")) {
        return {
          query_terms: ["foreign", "transaction", "fees"],
          matches: [
            {
              kind: "category",
              id: "c-fees",
              name: "Foreign Transaction Fees",
              this_month: 7.75,
              last_month: 3.25,
              three_month_total: 11.0,
              txn_count: 2,
            },
          ],
        };
      }
      return contextFacts;
    });

    const out =
      '{"answer":"You spent $7.75 on foreign transaction fees.","cited_facts":["c-fees"]}';
    const result = await runQaPipeline(ctx(out), {
      question: "How much did I spend on foreign transaction fees?",
    });
    expect(result.answer).toContain("7.75");
    expect(result.cited_facts).toEqual(["c-fees"]);
  });

  it("continues with empty matches when the search fetch fails", async () => {
    vi.mocked(ground).mockImplementation(async (path: string) => {
      if (path.startsWith("/ai/facts/search")) {
        throw new Error("search down");
      }
      return contextFacts;
    });

    const out = '{"answer":"Dining looks high.","cited_facts":["c1"]}';
    const result = await runQaPipeline(ctx(out), {
      question: "How am I doing on dining?",
    });
    expect(result.answer).toMatch(/dining/i);
  });
});
