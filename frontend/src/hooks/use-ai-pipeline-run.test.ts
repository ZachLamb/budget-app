import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const prepareFeatureMock = vi.fn();
const runFeatureMock = vi.fn();
const runMock = vi.fn();

vi.mock("@/lib/llm/ai-feature-gate", () => ({
  useAiFeatureGate: () => ({
    prepareFeature: prepareFeatureMock,
  }),
}));

vi.mock("@/lib/llm/useLlm", () => ({
  useLlm: () => ({
    runFeature: runFeatureMock,
    run: runMock,
  }),
}));

vi.mock("@/lib/hooks", () => ({ useDemoGuard: () => ({ isDemo: false }) }));

const { useAiPipelineRun } = await import("./use-ai-pipeline-run");

/** Let queued microtasks (the hook's own awaits) settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  prepareFeatureMock.mockReset();
  runFeatureMock.mockReset();
  runMock.mockReset();
  prepareFeatureMock.mockResolvedValue({ ok: true });
  runFeatureMock.mockResolvedValue({ advice: "Save more" });
});

describe("useAiPipelineRun", () => {
  it("runs feature after successful prepare", async () => {
    const { result } = renderHook(() => useAiPipelineRun("financial_advice"));

    let out: { advice: string } | undefined;
    await act(async () => {
      out = await result.current.run({ question: "test" });
    });

    expect(out).toEqual({ advice: "Save more" });
    expect(prepareFeatureMock).toHaveBeenCalledWith("financial_advice");
  });

  it("sets error when prepare is cancelled", async () => {
    prepareFeatureMock.mockResolvedValue({ ok: false, reason: "cancelled" });

    const { result } = renderHook(() => useAiPipelineRun("financial_advice"));

    await act(async () => {
      await expect(result.current.run({})).rejects.toThrow(/cancelled/i);
    });
    expect(result.current.error).toMatch(/cancelled/i);
  });

  it("rejects non-heavy features", async () => {
    const { result } = renderHook(() => useAiPipelineRun("explain_charge"));
    await act(async () => {
      await expect(result.current.run({})).rejects.toThrow(/heavy pipeline/i);
    });
  });

  it("treats OnDeviceError('aborted') as a cancellation, not an error", async () => {
    const { OnDeviceError } = await import("@/lib/llm/errors");
    runFeatureMock.mockRejectedValue(new OnDeviceError("aborted", "Cancelled."));

    const { result } = renderHook(() => useAiPipelineRun("financial_advice"));

    await act(async () => {
      await expect(result.current.run({})).rejects.toBeInstanceOf(OnDeviceError);
    });

    expect(result.current.cancelled).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("keeps the newest run cancellable when an older run settles late", async () => {
    const signals: AbortSignal[] = [];
    let releaseFirst: ((v: unknown) => void) | undefined;
    runFeatureMock.mockImplementation(
      (_f: string, _a: unknown, opts: { signal: AbortSignal }) => {
        signals.push(opts.signal);
        if (signals.length === 1) {
          return new Promise((resolve) => {
            releaseFirst = resolve;
          });
        }
        // Second run stays pending until it is cancelled.
        return new Promise(() => {});
      },
    );

    const { result } = renderHook(() => useAiPipelineRun("financial_advice"));

    await act(async () => {
      void result.current.run({}).catch(() => undefined);
      await flush();
    });
    expect(signals).toHaveLength(1);

    // Second run supersedes the first and installs its own controller.
    await act(async () => {
      void result.current.run({}).catch(() => undefined);
      await flush();
    });
    expect(signals).toHaveLength(2);

    // First run now settles and runs its finally block — which must not steal
    // the controller the second run is relying on.
    await act(async () => {
      releaseFirst?.({ advice: "stale" });
      await flush();
    });

    act(() => {
      result.current.cancel();
    });

    expect(signals[1]!.aborted).toBe(true);
  });
});

describe("isCancellation", () => {
  it("is true for an aborted signal regardless of the error shape", async () => {
    const { isCancellation } = await import("./use-ai-pipeline-run");
    const { OnDeviceError } = await import("@/lib/llm/errors");
    const ac = new AbortController();
    ac.abort();

    // A provider that swallows the abort and ends its stream surfaces a parse
    // failure, not an AbortError. The signal is what actually happened.
    expect(
      isCancellation(new OnDeviceError("schema_parse_failed", "malformed"), ac.signal),
    ).toBe(true);
    expect(isCancellation(new TypeError("boom"), ac.signal)).toBe(true);
  });

  it("is true for OnDeviceError('aborted') and DOM AbortError", async () => {
    const { isCancellation } = await import("./use-ai-pipeline-run");
    const { OnDeviceError } = await import("@/lib/llm/errors");
    const open = new AbortController().signal;

    expect(isCancellation(new OnDeviceError("aborted", "Cancelled."), open)).toBe(true);
    expect(isCancellation(new DOMException("Aborted", "AbortError"), open)).toBe(true);
  });

  it("is false for a genuine failure on a live signal", async () => {
    const { isCancellation } = await import("./use-ai-pipeline-run");
    const { OnDeviceError } = await import("@/lib/llm/errors");
    const open = new AbortController().signal;

    expect(
      isCancellation(new OnDeviceError("session_create_failed", "engine died"), open),
    ).toBe(false);
    expect(isCancellation(new TypeError("WebGPU adapter lost"), open)).toBe(false);
  });
});
