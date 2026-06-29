import { describe, expect, it } from "vitest";
import { interpretPrepareFeatureResult } from "./prepare-feature-result";

describe("interpretPrepareFeatureResult", () => {
  it("returns run for ok", () => {
    expect(interpretPrepareFeatureResult({ ok: true }).action).toBe("run");
  });

  it("returns cancelled copy for cancelled", () => {
    const r = interpretPrepareFeatureResult({ ok: false, reason: "cancelled" });
    expect(r.action).toBe("stop");
    if (r.action === "stop") {
      expect(r.userMessage).toMatch(/cancelled/i);
      expect(r.showSettingsLink).toBe(true);
    }
  });

  it("returns unavailable copy for unavailable", () => {
    const r = interpretPrepareFeatureResult({
      ok: false,
      reason: "unavailable",
      message: "On-device AI needs Chrome",
    });
    expect(r.action).toBe("stop");
    if (r.action === "stop") {
      expect(r.userMessage).toContain("Chrome");
    }
  });
});
