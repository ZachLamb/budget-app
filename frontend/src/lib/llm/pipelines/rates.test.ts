import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { CapabilitySnapshot, LLMProvider } from "../types";
import type { PipelineContext } from "./types";

vi.mock("./steps", async (orig) => {
  const mod = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...mod,
    ground: vi.fn().mockResolvedValue({
      accounts: [
        {
          account_id: "a1",
          name: "Store card",
          type: "credit",
          balance: 1000,
          has_apr: false,
          has_min_payment: false,
          current_apr: null,
          current_min_payment: null,
        },
      ],
    }),
  };
});

import { runRatesPipeline } from "./rates";

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

describe("runRatesPipeline", () => {
  it("accepts a valid bounded suggestion", async () => {
    const out =
      '{"suggestions":[{"account_id":"a1","suggested_apr":0.2299,"suggested_min_payment":35,"reasoning":"Typical store-card APR; verify on your statement."}]}';
    const result = await runRatesPipeline(ctx(out));
    expect(result.suggestions[0].account_id).toBe("a1");
    expect(result.suggestions[0].suggested_apr).toBeLessThanOrEqual(0.35);
  });

  it("rejects suggestions for unknown account ids", async () => {
    const out =
      '{"suggestions":[{"account_id":"a2","suggested_apr":0.2299,"suggested_min_payment":35,"reasoning":"x"}]}';
    await expect(runRatesPipeline(ctx(out))).rejects.toMatchObject({
      code: "verify_failed",
    });
  });

  it("rejects apr above 0.35", async () => {
    const out =
      '{"suggestions":[{"account_id":"a1","suggested_apr":0.99,"suggested_min_payment":35,"reasoning":"x"}]}';
    await expect(runRatesPipeline(ctx(out))).rejects.toMatchObject({
      code: "verify_failed",
    });
  });

  it("rejects a minimum payment above the balance", async () => {
    const out =
      '{"suggestions":[{"account_id":"a1","suggested_apr":0.2299,"suggested_min_payment":5000,"reasoning":"x"}]}';
    await expect(runRatesPipeline(ctx(out))).rejects.toMatchObject({
      code: "verify_failed",
    });
  });

  it("rejects empty reasoning", async () => {
    const out =
      '{"suggestions":[{"account_id":"a1","suggested_apr":0.2299,"suggested_min_payment":35,"reasoning":"   "}]}';
    await expect(runRatesPipeline(ctx(out))).rejects.toMatchObject({
      code: "verify_failed",
    });
  });
});
