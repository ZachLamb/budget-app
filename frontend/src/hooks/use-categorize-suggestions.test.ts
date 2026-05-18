import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const decideMock = vi.fn();
const getContextMock = vi.fn();
const suggestCategoriesMock = vi.fn();
const getCategorizeCandidatesMock = vi.fn();
const scanPromptMock = vi.fn();

vi.mock("@/lib/llm/useLlm", () => ({
  useLlm: () => ({
    decide: decideMock,
    getContext: getContextMock,
    capability: null,
    run: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/api/reports", () => ({
  reportsApi: {
    suggestCategories: (...args: unknown[]) => suggestCategoriesMock(...args),
    getCategorizeCandidates: (...args: unknown[]) => getCategorizeCandidatesMock(...args),
  },
}));

vi.mock("@/lib/llm/pii-detect", () => ({
  scanPrompt: (...args: unknown[]) => scanPromptMock(...args),
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
  decideMock.mockReset();
  getContextMock.mockReset();
  suggestCategoriesMock.mockReset();
  getCategorizeCandidatesMock.mockReset();
  scanPromptMock.mockReset();
  scanPromptMock.mockReturnValue({ flags: [], matchedText: {} });
});

describe("useCategorizeSuggestions – suggest() error routing", () => {
  it("propagates consent errors from suggestLocal instead of falling back to cloud", async () => {
    decideMock.mockResolvedValue({
      kind: "needs_consent",
      message: "On-device AI needs to download a model",
      reason: "needs_download_consent",
      tier: 2,
    });

    const { result } = renderHook(() => useCategorizeSuggestions(), { wrapper: wrap });

    await expect(
      act(() => result.current.suggest()),
    ).rejects.toThrow(/consent|download/i);

    expect(suggestCategoriesMock).not.toHaveBeenCalled();
  });

  it("falls back to cloud on non-consent runtime errors", async () => {
    decideMock.mockRejectedValue(new Error("inference failed"));

    scanPromptMock.mockReturnValue({ flags: [], matchedText: {} });

    const cloudData = [
      {
        transaction_id: "t1",
        suggested_category_id: "c1",
        payee_name: "Store",
        category_name: "Groceries",
      },
    ];
    suggestCategoriesMock.mockResolvedValue({ suggestions: cloudData });

    const { result } = renderHook(() => useCategorizeSuggestions(), { wrapper: wrap });

    let suggestions: unknown;
    await act(async () => {
      suggestions = await result.current.suggest();
    });

    expect(suggestions).toEqual(cloudData);
    expect(suggestCategoriesMock).toHaveBeenCalled();
  });
});
