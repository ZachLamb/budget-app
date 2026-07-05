import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
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

    await act(async () => {
      await expect(result.current.suggest()).rejects.toThrow(/cancelled/i);
    });
    expect(result.current.error).toMatch(/cancelled/i);
    expect(result.current.loading).toBe(false);
  });

  it("surfaces local inference failures", async () => {
    getCategorizeCandidatesMock.mockRejectedValue(new Error("inference failed"));

    const { result } = renderHook(() => useCategorizeSuggestions(), { wrapper: wrap });

    await expect(
      act(() => result.current.suggest()),
    ).rejects.toThrow(/inference failed/i);
    expect(result.current.loading).toBe(false);
  });

  it("exposes progress while loading candidates", async () => {
    let resolveCandidates!: (value: unknown) => void;
    getCategorizeCandidatesMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCandidates = resolve;
      }),
    );

    const { runStructuredJson } = await import("@/lib/llm/run-structured");
    vi.mocked(runStructuredJson).mockResolvedValue({
      data: [],
      tier: 1,
    });

    const { result } = renderHook(() => useCategorizeSuggestions(), { wrapper: wrap });

    act(() => {
      void result.current.suggest();
    });

    await waitFor(() => {
      expect(result.current.progress?.step).toBe("fetch");
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveCandidates({
        categories: [{ id: "c1", name: "Food" }],
        transactions: [{ id: "t1", payee: "Coffee Shop", amount: -5, date: "2026-01-01" }],
      });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.progress).toBeNull();
  });
});
