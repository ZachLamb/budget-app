import { describe, expect, it, vi, beforeEach } from "vitest";
import { OnDeviceError } from "./errors";
import type { LLMProvider } from "./types";
import type { CascadeProviders } from "./cascade";

vi.mock("./providers/cloud", () => ({
  hasCloudConsent: vi.fn().mockResolvedValue(false),
  streamCloudGenerate: vi.fn(),
}));

vi.mock("./pipelines/steps", async (orig) => {
  const mod = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...mod,
    generateVerified: vi.fn(),
    verify: (mod as { verify: typeof import("./pipelines/steps").verify }).verify,
  };
});

import { generateVerified } from "./pipelines/steps";
import { generateVerifiedWithCascade, resolveCascadeProviders } from "./cascade";

function stubProvider(tier: 1 | 2): LLMProvider {
  return {
    name: tier === 1 ? "nano" : "web-llm",
    tier,
    privacy: "local",
    async *generate() {
      yield "{}";
    },
  };
}

const cascade: CascadeProviders = {
  primary: stubProvider(1),
  localFallback: stubProvider(2),
  capability: {
    nano: { available: true, status: "available" },
    webgpu: { available: true, modelSize: "small" },
    specialized: {
      summarizer: false,
      writer: false,
      rewriter: false,
      proofreader: false,
    },
  },
};

beforeEach(() => {
  vi.mocked(generateVerified).mockReset();
});

describe("generateVerifiedWithCascade", () => {
  it("escalates to local fallback after primary verify_failed", async () => {
    vi.mocked(generateVerified)
      .mockRejectedValueOnce(new OnDeviceError("verify_failed", "bad"))
      .mockResolvedValueOnce({ ok: true });

    const result = await generateVerifiedWithCascade(
      cascade,
      "free_form_qa",
      { system: "s", prompt: "p", schema: {} },
      [(r: { ok: boolean }) => r.ok],
      { featureId: "free_form_qa", primaryRetries: 0 },
    );

    expect(result).toEqual({ ok: true });
    expect(generateVerified).toHaveBeenCalledTimes(2);
    expect(generateVerified.mock.calls[0]![0].tier).toBe(1);
    expect(generateVerified.mock.calls[1]![0].tier).toBe(2);
  });
});

describe("resolveCascadeProviders with no on-device tier", () => {
  const noDeviceCapability = {
    nano: { available: false, status: "unsupported" },
    webgpu: { available: false, modelSize: "none" },
    specialized: {
      summarizer: false,
      writer: false,
      rewriter: false,
      proofreader: false,
    },
  } as const;

  const ctx = {
    aiEnabledGlobally: true,
    providers: {
      nano: async () => stubProvider(1),
      webLlm: async () => stubProvider(2),
    },
  };

  it("falls back to the user's own server when preferLocal is set", async () => {
    const resolved = await resolveCascadeProviders(
      "financial_advice",
      ctx,
      noDeviceCapability as never,
      { preferLocal: true },
    );

    expect(resolved.localServerOnly).toBe(true);
    expect(resolved.primary.name).toBe("local-server");
    expect(resolved.primary.tier).toBe(4);
    expect(resolved.localFallback).toBeNull();
  });

  it("still reports unavailable when the user has not opted into a server", async () => {
    await expect(
      resolveCascadeProviders("financial_advice", ctx, noDeviceCapability as never),
    ).rejects.toThrow(/Chrome or Edge|isn't available/i);
  });
});
