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

const { useRealtimeEvents } = await import("./use-realtime-events");

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
});
