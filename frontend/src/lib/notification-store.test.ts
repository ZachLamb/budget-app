import { describe, it, expect, beforeEach } from "vitest";
import {
  pushNotification,
  clearAllNotifications,
  getNotificationSnapshot,
} from "@/lib/notification-store";

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
