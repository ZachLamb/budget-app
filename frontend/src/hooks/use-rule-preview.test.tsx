import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRulePreview } from "./use-rule-preview";

const previewCandidate = vi.fn();
vi.mock("@/lib/api/rules", () => ({
  rulesApi: { previewCandidate: (...a: unknown[]) => previewCandidate(...a) },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  previewCandidate.mockReset();
  previewCandidate.mockResolvedValue({ total: 3, sample: [] });
});
afterEach(() => vi.useRealTimers());

const candidate = (value: string, type = "contains") => ({
  match_field: "payee",
  match_type: type,
  match_value: value,
});

describe("useRulePreview", () => {
  it("does not ask on a one-character contains", async () => {
    // Every keystroke is a full scan of the uncategorized ledger, and
    // "b" tells you nothing about whether the pattern is right.
    renderHook(() => useRulePreview(candidate("b")), { wrapper });
    await vi.advanceTimersByTimeAsync(1000);
    expect(previewCandidate).not.toHaveBeenCalled();
  });

  it("does ask on a one-character exact, which is a real question", async () => {
    renderHook(() => useRulePreview(candidate("7", "exact")), { wrapper });
    await vi.advanceTimersByTimeAsync(1000);
    expect(previewCandidate).toHaveBeenCalledTimes(1);
  });

  it("asks once for a burst of typing, not once per keystroke", async () => {
    const { rerender } = renderHook(
      ({ v }) => useRulePreview(candidate(v)),
      { wrapper, initialProps: { v: "bl" } },
    );
    for (const v of ["blu", "blue", "blue ", "blue b"]) {
      rerender({ v });
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => expect(previewCandidate).toHaveBeenCalledTimes(1));
    expect(previewCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ match_value: "blue b" }),
    );
  });

  it("reads as working while the keystroke is still settling", async () => {
    const { result, rerender } = renderHook(
      ({ v }) => useRulePreview(candidate(v)),
      { wrapper, initialProps: { v: "blue" } },
    );
    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => expect(result.current.preview?.total).toBe(3));

    // A fresh keystroke: the badge must not read as a settled answer to
    // the old text while the new one is in flight.
    rerender({ v: "blue bo" });
    expect(result.current.isFetching).toBe(true);
  });

  it("asks nothing at all while the editor is closed", async () => {
    renderHook(() => useRulePreview(candidate("blue"), { enabled: false }), {
      wrapper,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(previewCandidate).not.toHaveBeenCalled();
  });

  it("re-asks when the match type changes under the same text", async () => {
    // "contains coffee" and "exact coffee" are different questions.
    const { rerender } = renderHook(
      ({ t }) => useRulePreview(candidate("coffee", t)),
      { wrapper, initialProps: { t: "contains" } },
    );
    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => expect(previewCandidate).toHaveBeenCalledTimes(1));
    rerender({ t: "exact" });
    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => expect(previewCandidate).toHaveBeenCalledTimes(2));
  });

  it("offers no highlight text for a regex", async () => {
    // Re-running the user's regex in the browser to find the offset would
    // be a second matcher, and a second place to disagree with the server.
    const { result } = renderHook(
      () => useRulePreview(candidate("^AMZN.*", "regex")),
      { wrapper },
    );
    await vi.advanceTimersByTimeAsync(600);
    expect(result.current.needle).toBe("");
  });

  it("surfaces a rejected pattern instead of retrying it", async () => {
    previewCandidate.mockRejectedValue(new Error("nested quantifier"));
    const { result } = renderHook(
      () => useRulePreview(candidate("(a+)+", "regex")),
      { wrapper },
    );
    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(previewCandidate).toHaveBeenCalledTimes(1);
  });
});
