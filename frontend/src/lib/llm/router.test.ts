import { describe, it, expect, vi } from "vitest";
import { decide, type RouterContext } from "./router";
import type { CapabilitySnapshot, LLMProvider } from "./types";
import type { FeatureId } from "./features";

const fakeProvider = (tier: 1 | 2 | 4): LLMProvider => ({
  name: tier === 1 ? "nano" : tier === 2 ? "web-llm" : "server",
  tier,
  privacy: tier === 4 ? "server" : "local",
  async *generate() {
    yield "stub";
  },
});

const baseCap = (): CapabilitySnapshot => ({
  nano: { available: false, status: "unsupported" },
  webgpu: { available: false, modelSize: "none" },
  server: { available: true },
});

const ctxFactory = (cloudGrants: FeatureId[] = [], aiEnabled = true) => ({
  aiEnabledGlobally: aiEnabled,
  cloudConsentGrants: new Set<FeatureId>(cloudGrants),
  providers: {
    nano: async () => fakeProvider(1),
    webLlm: async () => fakeProvider(2),
    server: async () => fakeProvider(4),
  },
});

describe("router.decide", () => {
  it("returns ai_disabled_globally when global toggle is off", async () => {
    const cap = baseCap();
    cap.nano = { available: true, status: "available" };
    const d = await decide("explain_charge", ctxFactory([], false), cap);
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
    // Tier 2 is gated on download consent — without it, returns needs_consent.
    const d = await decide("explain_charge", ctxFactory(), cap);
    expect(d.kind).toBe("needs_consent");
    if (d.kind === "needs_consent") {
      expect(d.tier).toBe(2);
      expect(d.reason).toBe("needs_download_consent");
    }
  });

  it("returns needs_cloud_consent when only Tier 4 is allowed and no grant", async () => {
    const cap = baseCap();
    const d = await decide("free_form_qa", ctxFactory(), cap);
    expect(d.kind).toBe("needs_consent");
    if (d.kind === "needs_consent") {
      expect(d.tier).toBe(4);
      expect(d.reason).toBe("needs_cloud_consent");
    }
  });

  it("uses Tier 4 directly when cloud consent is granted", async () => {
    const cap = baseCap();
    const d = await decide("free_form_qa", ctxFactory(["free_form_qa"]), cap);
    expect(d.kind).toBe("ready");
    if (d.kind === "ready") expect(d.tier).toBe(4);
  });

  it("returns unavailable_no_capable_tier when feature requires Tier 4 but server is somehow unreachable", async () => {
    const cap = baseCap();
    cap.server = { available: false };
    const d = await decide("free_form_qa", ctxFactory(["free_form_qa"]), cap);
    expect(d.kind).toBe("unavailable");
    if (d.kind === "unavailable") expect(d.reason).toBe("unavailable_no_capable_tier");
  });

  it("respects per-feature tier override when capable + allowed", async () => {
    const cap = baseCap();
    cap.nano = { available: true, status: "available" };
    const ctx = { ...ctxFactory(["explain_charge"]), preferredTierByFeature: { explain_charge: 4 as const } };
    const d = await decide("explain_charge", ctx, cap);
    expect(d.kind).toBe("ready");
    if (d.kind === "ready") expect(d.tier).toBe(4);
  });

  it("ignores override when target tier isn't allowed by policy", async () => {
    // budget_recommendations only allows tier 4. Override to 1 should be ignored.
    const cap = baseCap();
    cap.nano = { available: true, status: "available" };
    const ctx = { ...ctxFactory(["budget_recommendations"]), preferredTierByFeature: { budget_recommendations: 1 as const } };
    const d = await decide("budget_recommendations", ctx, cap);
    expect(d.kind).toBe("ready");
    if (d.kind === "ready") expect(d.tier).toBe(4);
  });
});

function nanoCap(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    nano: { available: true, status: "available" },
    webgpu: { available: false, modelSize: "none" },
    server: { available: true },
    specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
    ...overrides,
  };
}

function nanoCtx(): RouterContext {
  const provider = { name: "nano", tier: 1, privacy: "local", async *generate() {} } as never;
  return {
    aiEnabledGlobally: true,
    cloudConsentGrants: new Set(),
    providers: {
      nano: vi.fn().mockResolvedValue(provider),
      webLlm: vi.fn().mockResolvedValue(provider),
      server: vi.fn().mockResolvedValue(provider),
    },
  };
}

describe("decide — needs_nano_setup", () => {
  it("returns needs_nano_setup when Nano is the pick but status is downloadable", async () => {
    const c = nanoCtx();
    const d = await decide("explain_charge", c, nanoCap({ nano: { available: true, status: "downloadable" } }));
    expect(d.kind).toBe("needs_nano_setup");
    expect(c.providers.nano).not.toHaveBeenCalled();
  });

  it("returns ready (and instantiates Nano) when status is available", async () => {
    const c = nanoCtx();
    const d = await decide("explain_charge", c, nanoCap());
    expect(d.kind).toBe("ready");
    expect(c.providers.nano).toHaveBeenCalled();
  });
});
