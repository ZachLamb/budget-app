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

vi.mock("./intent", () => ({
  detectIntent: vi.fn().mockResolvedValue(null),
  prepareAction: vi.fn(),
}));

// The condense step is an uncontrolled LLM rewrite of the facts blob; the
// mock deliberately "hallucinates" an amount so the tests below can prove
// the grounded-amounts verifier still checks against the RAW facts.
vi.mock("../specialized", () => ({
  summarize: vi.fn(async () => "Condensed: the user spent $999.99 across many categories."),
}));

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

import { detectIntent, prepareAction } from "./intent";
import { summarize } from "../specialized";
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
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") return;
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
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") return;
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
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") return;
    expect(result.answer).toMatch(/dining/i);
  });

  it("returns action variant when intent is detected and prepare succeeds", async () => {
    vi.mocked(detectIntent).mockResolvedValueOnce({
      action_type: "create_category",
      data: { name: "Fees" },
      confirmation_text: "Create Fees?",
    });
    vi.mocked(prepareAction).mockResolvedValueOnce({
      ok: true,
      confirmation_token: "tok-1",
      preview: "Create category 'Fees'.",
      normalized_data: { name: "Fees" },
    });

    const result = await runQaPipeline(ctx("{}"), {
      question: "create a fees category",
    });
    expect(result).toEqual({
      kind: "action",
      preview: "Create category 'Fees'.",
      confirmationToken: "tok-1",
      actionType: "create_category",
      data: { name: "Fees" },
    });
  });

  it("returns answer with preview when prepare fails", async () => {
    vi.mocked(detectIntent).mockResolvedValueOnce({
      action_type: "bulk_recategorize",
      data: { payee_match: "x", category_name: "Missing" },
      confirmation_text: "Move?",
    });
    vi.mocked(prepareAction).mockResolvedValueOnce({
      ok: false,
      preview: "No category named 'Missing'. Create it first.",
      normalized_data: {},
    });

    const result = await runQaPipeline(ctx("{}"), { question: "recategorize x" });
    expect(result).toEqual({
      kind: "answer",
      answer: "No category named 'Missing'. Create it first.",
      cited_facts: [],
    });
  });
});

describe("condense path (facts above threshold)", () => {
  function bigFacts() {
    const categories = Array.from({ length: 120 }, (_, i) => ({
      category_id: `c${i}`,
      name: `Category number ${i}`,
      budgeted: 100 + i,
      actual: 50 + i,
      remaining: 50,
    }));
    return {
      ...contextFacts,
      budget: { ...contextFacts.budget, categories },
    };
  }

  function groundBig() {
    vi.mocked(ground).mockImplementation(async (path: string) => {
      if (path.startsWith("/ai/facts/search")) {
        return { query_terms: [], matches: [] };
      }
      return bigFacts();
    });
  }

  it("condenses oversized facts and still accepts a grounded answer", async () => {
    groundBig();
    vi.mocked(summarize).mockClear();
    const out =
      '{"answer":"Category number 5 has $105.00 budgeted.","cited_facts":["c5"]}';
    const result = await runQaPipeline(ctx(out), {
      question: "How is category 5 doing?",
    });
    expect(vi.mocked(summarize)).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("answer");
  });

  it("rejects amounts the condenser hallucinated (verifier checks raw facts)", async () => {
    groundBig();
    const out = '{"answer":"You spent $999.99 overall.","cited_facts":["c5"]}';
    await expect(
      runQaPipeline(ctx(out), { question: "How am I doing overall?" }),
    ).rejects.toMatchObject({ code: "verify_failed" });
  });
});

describe("generation progress wiring", () => {
  it("passes a token heartbeat and retry/verify progress into generateVerified", async () => {
    const { generateVerified } = await import("./steps");
    vi.mocked(ground).mockImplementation(async (path: string) =>
      path.startsWith("/ai/facts/search") ? { query_terms: [], matches: [] } : contextFacts,
    );
    const onProgress = vi.fn();
    const out = '{"answer":"You overspent on dining.","cited_facts":["c1"]}';
    await runQaPipeline({ ...ctx(out), onProgress }, { question: "dining?" });

    const call = vi.mocked(generateVerified).mock.calls.at(-1)!;
    const spec = call[1] as { onToken?: (n: number) => void };
    const opts = call[3] as { onProgress?: (p: { step: string; label: string }) => void };
    expect(typeof spec.onToken).toBe("function");
    expect(opts.onProgress).toBe(onProgress);

    // The heartbeat throttles: first emission only after >=120 chars.
    spec.onToken!(60);
    expect(onProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ label: expect.stringContaining("characters") }),
    );
    spec.onToken!(140);
    expect(onProgress).toHaveBeenCalledWith({
      step: "generate",
      label: "Writing the answer… (140 characters)",
    });
  });
});
