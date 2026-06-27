import { vi, describe, it, expect, beforeEach } from "vitest";

const fakeEngine = {
  reload: vi.fn(),
  chat: {
    completions: {
      create: vi.fn(),
    },
  },
  resetChat: vi.fn(),
};

const mockCreateMLCEngine = vi.fn().mockResolvedValue(fakeEngine);

vi.mock("@mlc-ai/web-llm", () => ({
  CreateMLCEngine: mockCreateMLCEngine,
}));

vi.mock("../capability", () => ({
  getCapability: vi.fn().mockResolvedValue({
    webgpu: { modelSize: "3b" },
    nano: { available: false, status: "unsupported" },
  }),
}));

vi.mock("../consent", () => ({
  getLocalConsent: vi.fn().mockReturnValue({}),
}));

vi.mock("../engine-busy", () => ({
  withEngineLockGenerator: vi.fn(),
}));

describe("ensureEngine", () => {
  beforeEach(async () => {
    mockCreateMLCEngine.mockClear();
    mockCreateMLCEngine.mockResolvedValue(fakeEngine);
    const mod = await import("./web-llm-engine");
    if ("_resetEngineForTest" in mod) {
      (mod as Record<string, () => void>)._resetEngineForTest();
    }
  });

  it("passes onProgress callback to CreateMLCEngine", async () => {
    const { ensureEngine } = await import("./web-llm-engine");
    const onProgress = vi.fn();
    await ensureEngine(onProgress);

    expect(mockCreateMLCEngine).toHaveBeenCalledWith(
      "Llama-3.2-3B-Instruct-q4f16_1-MLC",
      expect.objectContaining({ initProgressCallback: onProgress }),
    );
  });

  it("coalesces concurrent ensureEngine calls", async () => {
    const { ensureEngine, _resetEngineForTest } = await import("./web-llm-engine");
    _resetEngineForTest();

    const [a, b] = await Promise.all([ensureEngine(), ensureEngine()]);
    expect(a).toBe(b);
    expect(mockCreateMLCEngine).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed engine creation", async () => {
    const { ensureEngine, _resetEngineForTest } = await import("./web-llm-engine");
    _resetEngineForTest();

    mockCreateMLCEngine.mockRejectedValueOnce(new Error("boom"));

    await expect(ensureEngine()).rejects.toThrow("boom");

    mockCreateMLCEngine.mockResolvedValueOnce(fakeEngine);
    const eng = await ensureEngine();
    expect(eng).toBe(fakeEngine);
  });
});
