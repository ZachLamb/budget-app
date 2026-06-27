import { describe, it, expect, vi } from "vitest";
import { decide, type RouterContext } from "./router";
import type { CapabilitySnapshot, LLMProvider } from "./types";

const fakeProvider = (tier: 1 | 2): LLMProvider => ({
  name: tier === 1 ? "nano" : "web-llm",
  tier,
  privacy: "local",
  async *generate() {
    yield "stub";
  },
});

const baseCap = (): CapabilitySnapshot => ({
  nano: { available: false, status: "unsupported" },
  webgpu: { available: false, modelSize: "none" },
  specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
});

const ctxFactory = (aiEnabled = true): RouterContext => ({
  aiEnabledGlobally: aiEnabled,
  providers: {
    nano: async () => fakeProvider(1),
    webLlm: async () => fakeProvider(2),
  },
});

describe("router.decide", () => {
  it("returns ai_disabled_globally when global toggle is off", async () => {
    const cap = baseCap();
    cap.nano = { available: true, status: "available" };
    const d = await decide("explain_charge", ctxFactory(false), cap);
    expect(d.kind).toBe("unavailable");
    if (d.kind === "unavailable") expect(d.reason).toBe("ai_disabled_globally");
  });

  it("picks Tier 1 when Nano is available and feature allows it", async () => {
    const cap = baseCap();
    cap.nano = { available: true, status: "available" };
    const d = await decide("explain_charge", ctxFactory(), cap);
    expect(d.kind).toBe("ready");
    if (d.kind === "ready") expect(d.tier).toBe(1);
  });

  it("falls back to Tier 2 when Nano absent and webgpu present", async () => {
    const cap = baseCap();
    cap.webgpu = { available: true, modelSize: "3b" };
    const d = await decide("explain_charge", ctxFactory(), cap);
    expect(d.kind).toBe("needs_consent");
    if (d.kind === "needs_consent") {
      expect(d.tier).toBe(2);
      expect(d.reason).toBe("needs_download_consent");
    }
  });

  it("returns unavailable when heavy feature needs Nano but it is absent", async () => {
    const cap = baseCap();
    const d = await decide("free_form_qa", ctxFactory(), cap);
    expect(d.kind).toBe("unavailable");
    if (d.kind === "unavailable") {
      expect(d.reason).toBe("unavailable_no_capable_tier");
      expect(d.message).toMatch(/chrome or edge/i);
    }
  });

  it("runs heavy features on Nano when available", async () => {
    const cap = baseCap();
    cap.nano = { available: true, status: "available" };
    const d = await decide("free_form_qa", ctxFactory(), cap);
    expect(d.kind).toBe("ready");
    if (d.kind === "ready") expect(d.tier).toBe(1);
  });
});

function nanoCap(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    nano: { available: true, status: "available" },
    webgpu: { available: false, modelSize: "none" },
    specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
    ...overrides,
  };
}

function nanoCtx(): RouterContext {
  const provider = {
    name: "nano",
    tier: 1,
    privacy: "local",
    async *generate() {},
  } as LLMProvider;
  return {
    aiEnabledGlobally: true,
    providers: {
      nano: vi.fn().mockResolvedValue(provider),
      webLlm: vi.fn().mockResolvedValue(provider),
    },
  };
}

describe("decide — needs_nano_setup", () => {
  it.each(["downloadable", "downloading"] as const)(
    "returns needs_nano_setup (and never auto-downloads) when Nano is the pick but status is %s",
    async (status) => {
      const c = nanoCtx();
      const d = await decide("explain_charge", c, nanoCap({ nano: { available: true, status } }));
      expect(d.kind).toBe("needs_nano_setup");
      expect(c.providers.nano).not.toHaveBeenCalled();
    },
  );

  it("returns ready (and instantiates Nano) when status is available", async () => {
    const c = nanoCtx();
    const d = await decide("explain_charge", c, nanoCap());
    expect(d.kind).toBe("ready");
    expect(c.providers.nano).toHaveBeenCalled();
  });
});
