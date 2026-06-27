import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const prepareFeatureMock = vi.fn();
const getContextMock = vi.fn();
const getCategorizeCandidatesMock = vi.fn();

vi.mock("@/lib/llm/ai-feature-gate", () => ({
  useAiFeatureGate: () => ({
    prepareFeature: prepareFeatureMock,
  }),
}));

vi.mock("@/lib/llm/useLlm", () => ({
  useLlm: () => ({
    getContext: getContextMock,
    capability: null,
    run: vi.fn(),
    refresh: vi.fn(),
    decide: vi.fn(),
    runFeature: vi.fn(),
  }),
}));

vi.mock("@/lib/api/reports", () => ({
  reportsApi: {
    getCategorizeCandidates: (...args: unknown[]) => getCategorizeCandidatesMock(...args),
  },
}));

vi.mock("@/lib/demo-mode", () => ({ isDemoMode: false }));

vi.mock("@/lib/llm/run-structured", () => ({
  runStructuredJson: vi.fn(),
}));

vi.mock("@/lib/llm/prompts/categorize", () => ({
  CATEGORIZE_SYSTEM_PROMPT: "system",
  buildCategorizePrompt: vi.fn(() => "prompt"),
}));

const { useCategorizeSuggestions } = await import("./use-categorize-suggestions");

function wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  prepareFeatureMock.mockReset();
  prepareFeatureMock.mockResolvedValue({ ok: true });
  getContextMock.mockReset();
  getCategorizeCandidatesMock.mockReset();
});

describe("useCategorizeSuggestions – suggest() error routing", () => {
  it("propagates setup/unavailable errors without a cloud fallback", async () => {
    prepareFeatureMock.mockResolvedValue({
      ok: false,
      reason: "cancelled",
      message: "On-device AI needs to download a model",
    });

    const { result } = renderHook(() => useCategorizeSuggestions(), { wrapper: wrap });

    await expect(
      act(() => result.current.suggest()),
    ).rejects.toThrow(/consent|download|cancelled/i);
  });

  it("surfaces local inference failures", async () => {
    getCategorizeCandidatesMock.mockRejectedValue(new Error("inference failed"));

    const { result } = renderHook(() => useCategorizeSuggestions(), { wrapper: wrap });

    await expect(
      act(() => result.current.suggest()),
    ).rejects.toThrow(/inference failed/i);
  });
});
