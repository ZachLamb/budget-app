import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseCategorizeSuggestions,
  parseFsaStructured,
  parseJsonResponse,
  demoStructuredResult,
} from "./contracts";
import type { GenerateOptions, LLMProvider } from "./types";
import type { RouterContext } from "./router";
import { decide } from "./router";
import { runStructuredJson, runBatchedStructuredJson } from "./run-structured";

vi.mock("./router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./router")>();
  return { ...actual, decide: vi.fn() };
});

const decideMock = vi.mocked(decide);

/** Fake provider that records the GenerateOptions passed to `generate`. */
function recordingProvider(tier: 1 | 2, recorded: Array<GenerateOptions | undefined>): LLMProvider {
  return {
    name: tier === 1 ? "nano" : "web-llm",
    tier,
    privacy: "local",
    async *generate(_prompt: string, opts?: GenerateOptions) {
      recorded.push(opts);
      yield '{"eligible":[]}';
    },
  };
}

const fakeCtx: RouterContext = {
  aiEnabledGlobally: true,
  providers: {
    nano: async () => recordingProvider(1, []),
    webLlm: async () => recordingProvider(2, []),
  },
};

describe("runStructuredJson schema wiring", () => {
  beforeEach(() => {
    decideMock.mockReset();
  });

  it("passes a JSON schema to a tier-1 (Nano) provider for fsa_review", async () => {
    const recorded: Array<GenerateOptions | undefined> = [];
    const provider = recordingProvider(1, recorded);
    decideMock.mockResolvedValue({ kind: "ready", provider, tier: 1, reason: "ok" });

    const res = await runStructuredJson("fsa_review", fakeCtx, {
      system: "sys",
      prompt: "prompt",
    });

    expect(res.tier).toBe(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.schema).toBeDefined();
    expect(recorded[0]?.schema?.type).toBe("object");
  });

  it("does NOT pass a schema to a tier-2 (web-llm) provider", async () => {
    const recorded: Array<GenerateOptions | undefined> = [];
    const provider = recordingProvider(2, recorded);
    decideMock.mockResolvedValue({ kind: "ready", provider, tier: 2, reason: "ok" });

    const res = await runStructuredJson("fsa_review", fakeCtx, {
      system: "sys",
      prompt: "prompt",
    });

    expect(res.tier).toBe(2);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.schema).toBeUndefined();
  });

  it("passes a schema for categorize_transaction then falls back schema-less when generation throws", async () => {
    const recorded: Array<GenerateOptions | undefined> = [];
    // Engine rejects the array-root responseConstraint by throwing on the
    // schema'd call; yields valid JSON once the schema is omitted.
    const provider: LLMProvider = {
      name: "nano",
      tier: 1,
      privacy: "local",
      async *generate(_prompt: string, opts?: GenerateOptions) {
        recorded.push(opts);
        if (opts?.schema) {
          throw new Error("responseConstraint rejected: array root unsupported");
        }
        yield '[{"transaction_id":"t1","category_id":"c1"}]';
      },
    };
    decideMock.mockResolvedValue({ kind: "ready", provider, tier: 1, reason: "ok" });

    const res = await runStructuredJson("categorize_transaction", fakeCtx, {
      system: "sys",
      prompt: "prompt",
    });

    expect(res.tier).toBe(1);
    expect(recorded).toHaveLength(2);
    expect(recorded[0]?.schema).toBeDefined();
    expect(recorded[1]?.schema).toBeUndefined();
    expect(res.data).toEqual([{ transaction_id: "t1", category_id: "c1" }]);
  });
});

describe("contracts parsers", () => {
  it("parses FSA eligible object", () => {
    const raw = parseJsonResponse('{"eligible": [{"index": 0, "confidence": "high", "fsa_category": "Rx", "reason": "pharmacy"}]}');
    const out = parseFsaStructured(raw);
    expect(out.eligible).toHaveLength(1);
    expect(out.eligible[0]!.index).toBe(0);
  });

  it("parses categorize root array", () => {
    const raw = parseJsonResponse('[{"transaction_id": "t1", "category_id": "c1"}]');
    const out = parseCategorizeSuggestions(raw);
    expect(out).toEqual([{ transaction_id: "t1", category_id: "c1" }]);
  });

  it("demo FSA returns empty eligible", () => {
    const raw = demoStructuredResult("fsa_review");
    expect(parseFsaStructured(raw).eligible).toEqual([]);
  });

  it("demo budget_recommendations matches the pipeline result shape", () => {
    const raw = demoStructuredResult("budget_recommendations") as {
      recommendations: {
        category_id: string;
        suggested_amount: number;
        rationale: string;
      }[];
    };
    expect(Array.isArray(raw.recommendations)).toBe(true);
    expect(raw.recommendations[0]).toMatchObject({
      category_id: expect.any(String),
      suggested_amount: expect.any(Number),
      rationale: expect.any(String),
    });
  });

  it("demo goal_planning matches the pipeline result shape", () => {
    const raw = demoStructuredResult("goal_planning") as {
      plan: {
        goal_id: string;
        monthly_contribution: number;
        months_to_target: number;
        note: string;
      };
    };
    expect(raw.plan).toMatchObject({
      goal_id: expect.any(String),
      monthly_contribution: expect.any(Number),
      months_to_target: expect.any(Number),
      note: expect.any(String),
    });
  });

  it("demo free_form_qa matches the pipeline result shape", () => {
    const raw = demoStructuredResult("free_form_qa") as {
      answer: string;
      cited_facts: string[];
    };
    expect(raw.answer.length).toBeGreaterThan(0);
    expect(Array.isArray(raw.cited_facts)).toBe(true);
  });

  it("demo financial_advice carries advice, basis, disclaimer, and draft", () => {
    const raw = demoStructuredResult("financial_advice") as {
      advice: string;
      basis: string[];
      disclaimer: string;
      draft: boolean;
    };
    expect(raw.advice.length).toBeGreaterThan(0);
    expect(Array.isArray(raw.basis)).toBe(true);
    expect(raw.disclaimer).toMatch(/not professional financial advice/i);
    expect(raw.draft).toBe(true);
  });
});

function flakyProvider(): LLMProvider {
  return {
    name: "web-llm",
    tier: 2,
    privacy: "local",
    async *generate(prompt: string) {
      if (prompt.includes("FAIL")) throw new Error("engine crashed");
      yield '{"eligible":[{"index":0,"confidence":"high","fsa_category":"Rx","reason":"med"}]}';
    },
  };
}

describe("runBatchedStructuredJson alignment", () => {
  it("keeps one result slot per input batch when a middle batch fails", async () => {
    const provider = flakyProvider();
    decideMock.mockResolvedValue({ kind: "ready", provider, tier: 2, reason: "ok" });

    const res = await runBatchedStructuredJson("fsa_review", fakeCtx, {
      batches: [
        { system: "s", prompt: "batch0" },
        { system: "s", prompt: "FAIL batch1" },
        { system: "s", prompt: "batch2" },
      ],
    });

    expect(res.results).toHaveLength(3);
    expect(res.results[1]).toBeNull();
    expect(res.results[0]?.eligible).toHaveLength(1);
    expect(res.results[2]?.eligible).toHaveLength(1);
    expect(res.batchFailures).toBe(1);
  });
});
