import { describe, it, expect } from "vitest";
import { getLoginSkyPhase } from "./login-sky-phase";

function localDate(y: number, m: number, d: number, h: number, min = 0) {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

describe("getLoginSkyPhase", () => {
  it("uses theme mode when requested", () => {
    expect(getLoginSkyPhase(new Date(), "light", { mode: "theme" })).toBe("day");
    expect(getLoginSkyPhase(new Date(), "dark", { mode: "theme" })).toBe("night");
  });

  it("classifies clock hours (local)", () => {
    expect(getLoginSkyPhase(localDate(2026, 4, 5, 4), "light")).toBe("night");
    expect(getLoginSkyPhase(localDate(2026, 4, 5, 5), "light")).toBe("dawn");
    expect(getLoginSkyPhase(localDate(2026, 4, 5, 7), "light")).toBe("dawn");
    expect(getLoginSkyPhase(localDate(2026, 4, 5, 8), "light")).toBe("day");
    expect(getLoginSkyPhase(localDate(2026, 4, 5, 16), "light")).toBe("day");
    expect(getLoginSkyPhase(localDate(2026, 4, 5, 17), "light")).toBe("dusk");
    expect(getLoginSkyPhase(localDate(2026, 4, 5, 21), "light")).toBe("dusk");
    expect(getLoginSkyPhase(localDate(2026, 4, 5, 22), "light")).toBe("night");
    expect(getLoginSkyPhase(localDate(2026, 4, 5, 23), "dark")).toBe("night");
  });
});
