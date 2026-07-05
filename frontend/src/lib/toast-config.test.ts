import { describe, it, expect } from "vitest";
import { TOASTER_PROPS, toastDedupeId } from "@/lib/toast-config";

describe("toast-config", () => {
  it("places toasts top-right with a capped stack", () => {
    expect(TOASTER_PROPS.position).toBe("top-right");
    expect(TOASTER_PROPS.visibleToasts).toBe(3);
    expect(TOASTER_PROPS.expand).toBe(false);
  });

  it("builds stable dedupe ids", () => {
    expect(toastDedupeId("error", "Save failed")).toBe("error:Save failed");
  });
});
