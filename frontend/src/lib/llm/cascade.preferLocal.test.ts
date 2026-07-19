import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./providers/cloud", () => ({
  streamCloudGenerate: vi.fn(),
  hasCloudConsent: vi.fn(),
}));
vi.mock("./pipelines/steps", () => ({
  generateVerified: vi.fn(),
  verify: vi.fn((d) => d),
}));

import { generateVerifiedWithCascade } from "./cascade";
import { streamCloudGenerate, hasCloudConsent } from "./providers/cloud";
import { generateVerified } from "./pipelines/steps";
import type { CascadeProviders } from "./cascade";

const spec = { system: "s", prompt: "p" } as never;

function providers(): CascadeProviders {
  return {
    primary: { tier: 1, generate: async function* () {} } as never,
    localFallback: null,
    capability: {} as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateVerifiedWithCascade preferLocal", () => {
  it("uses the local server first when preferLocal is set", async () => {
    vi.mocked(streamCloudGenerate).mockResolvedValue('{"answer":"from-gemma"}');

    const out = await generateVerifiedWithCascade(providers(), "financial_advice", spec, [], {
      featureId: "financial_advice",
      preferLocal: true,
    });

    expect(out).toEqual({ answer: "from-gemma" });
    expect(streamCloudGenerate).toHaveBeenCalledTimes(1);
    expect(generateVerified).not.toHaveBeenCalled();
  });

  it("falls back to on-device when the local server is unavailable", async () => {
    vi.mocked(streamCloudGenerate).mockRejectedValue(new Error("connection refused"));
    vi.mocked(generateVerified).mockResolvedValue({ answer: "on-device" } as never);

    const out = await generateVerifiedWithCascade(providers(), "financial_advice", spec, [], {
      featureId: "financial_advice",
      preferLocal: true,
    });

    expect(streamCloudGenerate).toHaveBeenCalledTimes(1);
    expect(generateVerified).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ answer: "on-device" });
  });

  it("does not touch the local server when preferLocal is off (on-device primary)", async () => {
    vi.mocked(generateVerified).mockResolvedValue({ answer: "on-device" } as never);

    const out = await generateVerifiedWithCascade(providers(), "financial_advice", spec, [], {
      featureId: "financial_advice",
      preferLocal: false,
    });

    expect(generateVerified).toHaveBeenCalledTimes(1);
    expect(streamCloudGenerate).not.toHaveBeenCalled();
    expect(out).toEqual({ answer: "on-device" });
  });

  it("does not consult per-feature cloud consent in preferLocal mode", async () => {
    vi.mocked(streamCloudGenerate).mockResolvedValue('{"answer":"x"}');
    await generateVerifiedWithCascade(providers(), "financial_advice", spec, [], {
      featureId: "financial_advice",
      preferLocal: true,
    });
    // Blanket local consent — the per-feature consent path is skipped entirely.
    expect(hasCloudConsent).not.toHaveBeenCalled();
  });
});
