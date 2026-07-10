import { describe, it, expect } from "vitest";
import { visitedThisCycle, deriveCycleSteps, type CycleStepInput } from "./cycle-progress";

describe("visitedThisCycle", () => {
  const cycleStart = "2026-07-01";

  it("is false when either input is missing", () => {
    expect(visitedThisCycle(null, cycleStart)).toBe(false);
    expect(visitedThisCycle("2026-07-05T10:00:00Z", null)).toBe(false);
  });

  it("is true for a visit on or after the cycle start", () => {
    expect(visitedThisCycle("2026-07-05T10:00:00", cycleStart)).toBe(true);
    expect(visitedThisCycle("2026-07-01T00:00:00", cycleStart)).toBe(true);
  });

  it("is false for a visit before the cycle start (prior cycle)", () => {
    expect(visitedThisCycle("2026-06-28T23:59:00", cycleStart)).toBe(false);
  });

  it("is false for an unparseable timestamp", () => {
    expect(visitedThisCycle("not-a-date", cycleStart)).toBe(false);
  });
});

describe("deriveCycleSteps", () => {
  const base: CycleStepInput = {
    cycleStart: "2026-07-01",
    serverObserved: false,
    serverDiagnosed: false,
    observedAt: null,
    diagnosedAt: null,
    decidedThisCycle: false,
  };

  it("marks nothing done at the start of a cycle", () => {
    const s = deriveCycleSteps(base);
    expect(s).toMatchObject({ observed: false, diagnosed: false, decided: false, doneCount: 0, allDone: false });
  });

  it("marks steps independently from their signals", () => {
    const s = deriveCycleSteps({
      ...base,
      observedAt: "2026-07-03T09:00:00",
      decidedThisCycle: true,
    });
    expect(s.observed).toBe(true);
    expect(s.diagnosed).toBe(false);
    expect(s.decided).toBe(true);
    expect(s.doneCount).toBe(2);
    expect(s.allDone).toBe(false);
  });

  it("server signals satisfy steps without any local visit", () => {
    const s = deriveCycleSteps({ ...base, serverObserved: true, serverDiagnosed: true });
    expect(s.observed).toBe(true);
    expect(s.diagnosed).toBe(true);
  });

  it("local visit satisfies a step before the server flag lands", () => {
    const s = deriveCycleSteps({ ...base, diagnosedAt: "2026-07-04T09:00:00" });
    expect(s.diagnosed).toBe(true);
    expect(s.observed).toBe(false);
  });

  it("is allDone only when all three signals are satisfied", () => {
    const s = deriveCycleSteps({
      ...base,
      serverObserved: true,
      diagnosedAt: "2026-07-04T09:00:00",
      decidedThisCycle: true,
    });
    expect(s.doneCount).toBe(3);
    expect(s.allDone).toBe(true);
  });

  it("ignores local visits from a previous cycle", () => {
    const s = deriveCycleSteps({
      ...base,
      observedAt: "2026-06-20T09:00:00",
      diagnosedAt: "2026-06-21T09:00:00",
    });
    expect(s.doneCount).toBe(0);
  });
});
