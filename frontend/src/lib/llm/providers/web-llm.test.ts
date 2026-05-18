import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMProvider } from "../types";

const fakeProvider: LLMProvider = {
  id: "web-llm",
  label: "WebLLM",
  generate: vi.fn(),
};

vi.mock("./web-llm-engine", () => ({
  get webLlmProvider() {
    return mockImport();
  },
}));

const mockImport = vi.fn<() => LLMProvider>(() => fakeProvider);

describe("getWebLlmProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    mockImport.mockClear();
    mockImport.mockReturnValue(fakeProvider);
  });

  it("retries after a failed import instead of caching the rejected promise", async () => {
    const { getWebLlmProvider } = await import("./web-llm");

    mockImport.mockImplementationOnce(() => {
      throw new Error("network failure");
    });

    await expect(getWebLlmProvider()).rejects.toThrow("network failure");

    mockImport.mockReturnValue(fakeProvider);

    const result = await getWebLlmProvider();
    expect(result).toBe(fakeProvider);
  });

  it("deduplicates concurrent successful calls", async () => {
    const { getWebLlmProvider } = await import("./web-llm");

    const [a, b] = await Promise.all([
      getWebLlmProvider(),
      getWebLlmProvider(),
    ]);

    expect(a).toBe(fakeProvider);
    expect(b).toBe(fakeProvider);
    expect(mockImport).toHaveBeenCalledTimes(1);
  });
});
