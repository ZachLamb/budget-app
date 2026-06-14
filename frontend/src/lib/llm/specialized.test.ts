import { afterEach, describe, expect, it, vi } from "vitest";
import { summarize, rewriteProse, proofread } from "./specialized";
import type { LLMProvider } from "./types";

function fakeNano(output: string): LLMProvider {
  return {
    name: "nano",
    tier: 1,
    privacy: "local",
    async *generate() {
      yield output;
    },
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).Summarizer;
  delete (globalThis as Record<string, unknown>).Rewriter;
  delete (globalThis as Record<string, unknown>).Proofreader;
});

describe("summarize", () => {
  it("uses the Summarizer API when available", async () => {
    const summarizer = { summarize: vi.fn().mockResolvedValue("short") };
    (globalThis as Record<string, unknown>).Summarizer = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockResolvedValue(summarizer),
    };
    const out = await summarize(fakeNano("FALLBACK"), "long text", { signal: undefined });
    expect(out).toBe("short");
    expect(summarizer.summarize).toHaveBeenCalledWith("long text");
  });

  it("falls back to the Prompt API when Summarizer is absent", async () => {
    const out = await summarize(fakeNano("prompt summary"), "long text", { signal: undefined });
    expect(out).toBe("prompt summary");
  });
});

describe("rewriteProse", () => {
  it("uses the Rewriter API when available", async () => {
    const rewriter = { rewrite: vi.fn().mockResolvedValue("api-rewritten") };
    (globalThis as Record<string, unknown>).Rewriter = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockResolvedValue(rewriter),
    };
    const out = await rewriteProse(fakeNano("FALLBACK"), "draft", "make it concise", {});
    expect(out).toBe("api-rewritten");
  });

  it("falls back to the Prompt API when Rewriter is absent", async () => {
    const out = await rewriteProse(fakeNano("rewritten"), "draft", "make it concise", {});
    expect(out).toBe("rewritten");
  });
});

describe("proofread", () => {
  it("returns the input unchanged when Proofreader is absent (no fallback model call)", async () => {
    const nano = fakeNano("SHOULD_NOT_BE_USED");
    const out = await proofread(nano, "teh cat");
    expect(out).toBe("teh cat");
  });

  it("uses the Proofreader API correction when available", async () => {
    const pf = { proofread: vi.fn().mockResolvedValue({ correctedInput: "the cat" }) };
    (globalThis as Record<string, unknown>).Proofreader = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockResolvedValue(pf),
    };
    const out = await proofread(fakeNano("x"), "teh cat");
    expect(out).toBe("the cat");
  });
});
