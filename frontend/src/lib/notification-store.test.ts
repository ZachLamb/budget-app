import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  pushNotification,
  clearAllNotifications,
  getNotificationSnapshot,
} from "@/lib/notification-store";

describe("notification-store ids", () => {
  beforeEach(() => {
    clearAllNotifications();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("assigns unique ids to a same-millisecond burst without crypto.randomUUID", () => {
    // Safari < 15.4 / any non-secure context: no randomUUID available.
    vi.stubGlobal("crypto", {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:00.000Z"));

    // Distinct titles so the dedupe window doesn't collapse them.
    for (let i = 0; i < 5; i++) {
      pushNotification({ kind: "error", title: `Request ${i} failed` });
    }
    vi.useRealTimers();

    const ids = getNotificationSnapshot().map((n) => n.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it("honors an explicitly supplied id", () => {
    pushNotification({ kind: "info", title: "Synced", id: "fixed-id" });
    expect(getNotificationSnapshot()[0]!.id).toBe("fixed-id");
  });
});

describe("notification-store dedupe", () => {
  beforeEach(() => {
    clearAllNotifications();
  });

  it("skips duplicate notifications within the dedupe window", () => {
    pushNotification({ kind: "error", title: "Failed to save", description: "Network error" });
    pushNotification({ kind: "error", title: "Failed to save", description: "Network error" });
    expect(getNotificationSnapshot()).toHaveLength(1);
  });

  it("allows the same title with a different description", () => {
    pushNotification({ kind: "error", title: "Failed", description: "One" });
    pushNotification({ kind: "error", title: "Failed", description: "Two" });
    expect(getNotificationSnapshot()).toHaveLength(2);
  });
});
