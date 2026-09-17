import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBackendWake } from "./use-backend-wake";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useBackendWake", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays idle while the backend answers quickly", async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useBackendWake({ probe }));

    // A warm backend must never flash the strip at the user.
    expect(result.current.status).toBe("idle");
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("reveals as waking only after the threshold passes", async () => {
    const d = deferred<void>();
    const probe = vi.fn().mockReturnValue(d.promise);
    const { result } = renderHook(() =>
      useBackendWake({ probe, revealAfterMs: 1500, estimateMs: 35000 }),
    );

    expect(result.current.status).toBe("idle");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.status).toBe("idle");

    await act(async () => {
      vi.advanceTimersByTime(1000); // now 2000ms total
    });
    expect(result.current.status).toBe("waking");
  });

  it("caps progress below 100% no matter how long the wait runs", async () => {
    const d = deferred<void>();
    const probe = vi.fn().mockReturnValue(d.promise);
    const { result } = renderHook(() =>
      useBackendWake({ probe, revealAfterMs: 1500, estimateMs: 10000 }),
    );

    // Run well past the estimate — an unresolved probe must never read 100%.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.status).toBe("waking");
    expect(result.current.progress).toBeLessThan(1);
    expect(result.current.progress).toBeCloseTo(0.9, 5);
  });

  it("snaps to 100% once the backend actually responds", async () => {
    const d = deferred<void>();
    const probe = vi.fn().mockReturnValue(d.promise);
    const { result } = renderHook(() =>
      useBackendWake({ probe, revealAfterMs: 1500, estimateMs: 35000 }),
    );

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.progress).toBeLessThan(1);

    await act(async () => {
      d.resolve();
      await d.promise;
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.progress).toBe(1);
    expect(result.current.secondsRemaining).toBeNull();
  });

  it("reports error when the backend cannot be reached", async () => {
    const probe = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useBackendWake({ probe }));

    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("does not probe when disabled", () => {
    const probe = vi.fn();
    renderHook(() => useBackendWake({ enabled: false, probe }));
    expect(probe).not.toHaveBeenCalled();
  });

  it("counts down seconds remaining against the estimate", async () => {
    const d = deferred<void>();
    const probe = vi.fn().mockReturnValue(d.promise);
    const { result } = renderHook(() =>
      useBackendWake({ probe, revealAfterMs: 1500, estimateMs: 30000 }),
    );

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.secondsRemaining).toBeLessThanOrEqual(20);
    expect(result.current.secondsRemaining).toBeGreaterThan(15);
  });
});
