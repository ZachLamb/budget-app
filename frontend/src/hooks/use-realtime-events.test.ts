import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// MockEventSource simulates the browser EventSource API
class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  withCredentials: boolean;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = options?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  simulateOpen() {
    this.onopen?.();
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }

  simulateError() {
    this.onerror?.();
  }
}

// Install mock before importing the hook
vi.stubGlobal("EventSource", MockEventSource);

const { useRealtimeEvents, reconnectDelayMs } = await import("./use-realtime-events");

beforeEach(() => {
  MockEventSource.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllTimers();
});

describe("useRealtimeEvents", () => {
  it("connects to /api/realtime/events", () => {
    const onEvent = vi.fn();
    renderHook(() => useRealtimeEvents(onEvent));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toContain("/api/realtime/events");
  });

  it("calls onEvent when message arrives", () => {
    const onEvent = vi.fn();
    renderHook(() => useRealtimeEvents(onEvent));

    const es = MockEventSource.instances[0]!;
    act(() => {
      es.simulateMessage(JSON.stringify({ type: "transaction.created" }));
    });

    expect(onEvent).toHaveBeenCalledWith("transaction.created");
  });

  it("sets connected true on open", () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() => useRealtimeEvents(onEvent));

    act(() => {
      MockEventSource.instances[0]!.simulateOpen();
    });

    expect(result.current.connected).toBe(true);
  });

  it("closes EventSource on unmount", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useRealtimeEvents(onEvent));

    const es = MockEventSource.instances[0]!;
    unmount();

    expect(es.close).toHaveBeenCalled();
  });

  it("backs off between reconnects instead of hammering the rate limit", () => {
    const onEvent = vi.fn();
    renderHook(() => useRealtimeEvents(onEvent));

    // Three consecutive failures, each followed by the *previous* delay only.
    // If the delay never grew, the third attempt would already have happened.
    act(() => {
      MockEventSource.instances[0]!.simulateError();
    });
    act(() => {
      vi.advanceTimersByTime(3000 * 1.25);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    act(() => {
      MockEventSource.instances[1]!.simulateError();
    });
    act(() => {
      vi.advanceTimersByTime(3000 * 1.25);
    });
    // Second retry waits ~6s, so nothing new after only ~3.75s.
    expect(MockEventSource.instances).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(6000 * 1.25);
    });
    expect(MockEventSource.instances).toHaveLength(3);
  });

  it("resets the backoff once a connection opens", () => {
    const onEvent = vi.fn();
    renderHook(() => useRealtimeEvents(onEvent));

    // Fail twice to grow the delay...
    act(() => {
      MockEventSource.instances[0]!.simulateError();
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    act(() => {
      MockEventSource.instances[1]!.simulateError();
    });
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(MockEventSource.instances).toHaveLength(3);

    // ...then succeed, which resets it back to the base delay.
    act(() => {
      MockEventSource.instances[2]!.simulateOpen();
    });
    act(() => {
      MockEventSource.instances[2]!.simulateError();
    });
    act(() => {
      vi.advanceTimersByTime(3000 * 1.25);
    });
    expect(MockEventSource.instances).toHaveLength(4);
  });

  it("does not reconnect after unmount", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useRealtimeEvents(onEvent));

    unmount();
    act(() => {
      MockEventSource.instances[0]!.simulateError();
      vi.advanceTimersByTime(60_000);
    });

    expect(MockEventSource.instances).toHaveLength(1);
  });
});

describe("reconnectDelayMs", () => {
  it("grows exponentially and caps out", () => {
    const mid = () => 0.5; // no jitter
    expect(reconnectDelayMs(1, mid)).toBe(3000);
    expect(reconnectDelayMs(2, mid)).toBe(6000);
    expect(reconnectDelayMs(3, mid)).toBe(12_000);
    expect(reconnectDelayMs(10, mid)).toBe(60_000);
    expect(reconnectDelayMs(99, mid)).toBe(60_000);
  });

  it("never drops below the base delay, even at minimum jitter", () => {
    expect(reconnectDelayMs(1, () => 0)).toBeGreaterThanOrEqual(3000);
    expect(reconnectDelayMs(5, () => 0)).toBeGreaterThanOrEqual(3000);
  });

  it("applies jitter within ±25%", () => {
    expect(reconnectDelayMs(3, () => 1)).toBe(15_000);
    expect(reconnectDelayMs(3, () => 0)).toBe(9000);
  });

  it("stays under the server's 10-per-minute connection cap in steady state", () => {
    // Worst case (minimum jitter) over the first minute of an outage.
    let elapsed = 0;
    let attempts = 0;
    while (elapsed < 60_000) {
      attempts += 1;
      elapsed += reconnectDelayMs(attempts, () => 0);
    }
    expect(attempts).toBeLessThanOrEqual(10);
  });
});
