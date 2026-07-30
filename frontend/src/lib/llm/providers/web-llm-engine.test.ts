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

// Pass-through: the lock's own behavior is covered by engine-busy's tests, and
// generate() needs the wrapped generator to actually run.
vi.mock("../engine-busy", () => ({
  withEngineLockGenerator: async function* <T>(fn: () => AsyncGenerator<T>) {
    yield* fn();
  },
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

describe("webLlmProvider.generate", () => {
  beforeEach(async () => {
    mockCreateMLCEngine.mockClear();
    mockCreateMLCEngine.mockResolvedValue(fakeEngine);
    fakeEngine.resetChat.mockClear();
    fakeEngine.chat.completions.create.mockReset();
    const { _resetEngineForTest } = await import("./web-llm-engine");
    _resetEngineForTest();
  });

  function stubStream(deltas: string[]) {
    fakeEngine.chat.completions.create.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        for (const content of deltas) yield { choices: [{ delta: { content } }] };
      },
    });
  }

  it("yields the streamed deltas", async () => {
    const { webLlmProvider } = await import("./web-llm-engine");
    stubStream(["Hello ", "world"]);

    const out: string[] = [];
    for await (const chunk of webLlmProvider.generate("p")) out.push(chunk);

    expect(out).toEqual(["Hello ", "world"]);
  });

  it("throws AbortError when the signal is aborted mid-stream", async () => {
    const { webLlmProvider } = await import("./web-llm-engine");
    const ac = new AbortController();
    stubStream(["first", "second", "third"]);

    const out: string[] = [];
    const consume = async () => {
      for await (const chunk of webLlmProvider.generate("p", { signal: ac.signal })) {
        out.push(chunk);
        ac.abort();
      }
    };

    // Silently ending the stream would make a cancelled run look like a short
    // successful one, and hand back a truncated answer if it happened to parse.
    await expect(consume()).rejects.toMatchObject({ name: "AbortError" });
    expect(out).toEqual(["first"]);
  });
});
