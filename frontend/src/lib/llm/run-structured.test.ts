import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseCategorizeSuggestions,
  parseFsaStructured,
  parseJsonResponse,
  demoStructuredResult,
} from "./contracts";
import type { GenerateOptions, LLMProvider, Tier } from "./types";
import type { RouterContext } from "./router";
import { decide } from "./router";
import { runStructuredJson } from "./run-structured";

vi.mock("./router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./router")>();
  return { ...actual, decide: vi.fn() };
});

const decideMock = vi.mocked(decide);

/** Fake provider that records the GenerateOptions passed to `generate`. */
function recordingProvider(tier: Tier, recorded: Array<GenerateOptions | undefined>): LLMProvider {
  return {
    name: tier === 1 ? "nano" : tier === 2 ? "web-llm" : "server",
    tier,
    privacy: tier === 4 ? "server" : "local",
    async *generate(_prompt: string, opts?: GenerateOptions) {
      recorded.push(opts);
      yield '{"eligible":[]}';
    },
  };
}

const fakeCtx: RouterContext = {
  aiEnabledGlobally: true,
  cloudConsentGrants: new Set(),
  providers: {
    nano: async () => recordingProvider(1, []),
    webLlm: async () => recordingProvider(2, []),
    server: async () => recordingProvider(4, []),
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
});
