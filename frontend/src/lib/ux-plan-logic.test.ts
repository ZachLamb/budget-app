import { describe, it, expect } from "vitest";
import {
  CHART_FALLBACK,
  resolveChartSeriesColors,
  shouldShowMobileSyncBanner,
  resolveMobileDataBarKind,
  buildSetupSteps,
  isCoreSetupComplete,
  resolveDefaultAccountId,
} from "./ux-plan-logic";

describe("shouldShowMobileSyncBanner", () => {
  it("returns false when last sync is missing", () => {
    expect(shouldShowMobileSyncBanner(undefined)).toBe(false);
    expect(shouldShowMobileSyncBanner(null)).toBe(false);
  });

  it("returns false when completed_at is missing", () => {
    expect(
      shouldShowMobileSyncBanner({
        status: "error",
        completed_at: null,
        error_message: "x",
      }),
    ).toBe(false);
  });

  it("returns false for success or in_progress", () => {
    expect(
      shouldShowMobileSyncBanner({
        status: "success",
        completed_at: "2025-01-01T00:00:00Z",
      }),
    ).toBe(false);
    expect(
      shouldShowMobileSyncBanner({
        status: "in_progress",
        completed_at: "2025-01-01T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("returns true for error or partial when completed", () => {
    expect(
      shouldShowMobileSyncBanner({
        status: "error",
        completed_at: "2025-01-01T00:00:00Z",
        error_message: "bad",
      }),
    ).toBe(true);
    expect(
      shouldShowMobileSyncBanner({
        status: "partial",
        completed_at: "2025-01-01T00:00:00Z",
      }),
    ).toBe(true);
  });
});

describe("resolveMobileDataBarKind", () => {
  it("prefers syncing over problem or stale", () => {
    expect(
      resolveMobileDataBarKind(true, true, {
        status: "error",
        completed_at: "2025-01-01T00:00:00Z",
      }),
    ).toBe("syncing");
  });

  it("prefers problem over stale", () => {
    expect(
      resolveMobileDataBarKind(false, true, {
        status: "error",
        completed_at: "2025-01-01T00:00:00Z",
      }),
    ).toBe("problem");
  });

  it("returns stale when flagged and last sync was ok", () => {
    expect(
      resolveMobileDataBarKind(false, true, {
        status: "success",
        completed_at: "2025-01-01T00:00:00Z",
      }),
    ).toBe("stale");
  });

  it("returns null when not syncing, not stale, and no problem", () => {
    expect(
      resolveMobileDataBarKind(false, false, {
        status: "success",
        completed_at: "2025-01-01T00:00:00Z",
      }),
    ).toBe(null);
  });
});

describe("resolveChartSeriesColors", () => {
  it("uses CSS variables when present", () => {
    const colors = resolveChartSeriesColors(3, (name) => {
      if (name === "--chart-1") return " #abc ";
      if (name === "--chart-2") return "rgb(1,2,3)";
      if (name === "--chart-3") return "oklch(0.5 0.1 0)";
      return "";
    });
    expect(colors[0]).toBe("#abc");
    expect(colors[1]).toBe("rgb(1,2,3)");
    expect(colors[2]).toBe("oklch(0.5 0.1 0)");
  });

  it("falls back per slot when CSS var is empty", () => {
    const colors = resolveChartSeriesColors(6, () => "");
    expect(colors.length).toBe(6);
    expect(colors[0]).toBe(CHART_FALLBACK[0]);
    expect(colors[5]).toBe(CHART_FALLBACK[5 % CHART_FALLBACK.length]);
  });

  it("cycles chart-1..5 for indices beyond five", () => {
    const colors = resolveChartSeriesColors(8, () => "");
    expect(colors[5]).toBe(CHART_FALLBACK[0]);
    expect(colors[6]).toBe(CHART_FALLBACK[1]);
  });
});

describe("buildSetupSteps + isCoreSetupComplete", () => {
  it("marks core steps done independently of optional bank", () => {
    const steps = buildSetupSteps({
      accountCount: 1,
      transactionTotal: 5,
      budgetAssigned: 10,
      simplefinConfigured: false,
    });
    expect(steps.find((s) => s.id === "account")?.done).toBe(true);
    expect(steps.find((s) => s.id === "txns")?.done).toBe(true);
    expect(steps.find((s) => s.id === "budget")?.done).toBe(true);
    expect(steps.find((s) => s.id === "bank")?.done).toBe(false);
    expect(isCoreSetupComplete(steps)).toBe(true);
  });

  it("core incomplete when any required step missing", () => {
    const steps = buildSetupSteps({
      accountCount: 0,
      transactionTotal: 0,
      budgetAssigned: 0,
      simplefinConfigured: false,
    });
    expect(isCoreSetupComplete(steps)).toBe(false);
  });
});

describe("resolveDefaultAccountId", () => {
  it("prefers the active account filter", () => {
    expect(resolveDefaultAccountId("acc-2", ["acc-1", "acc-2", "acc-3"])).toBe("acc-2");
  });

  it("falls back to the first account when no filter is set", () => {
    expect(resolveDefaultAccountId("", ["acc-1", "acc-2"])).toBe("acc-1");
    expect(resolveDefaultAccountId(undefined, ["acc-1", "acc-2"])).toBe("acc-1");
  });

  it("returns empty string when there are no accounts", () => {
    expect(resolveDefaultAccountId("", [])).toBe("");
    expect(resolveDefaultAccountId(undefined, [])).toBe("");
  });
});
