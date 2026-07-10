/**
 * Auto-derived progress for the "This pay cycle" checklist.
 *
 * Instead of a manual "advance" button (easy to mis-click, no undo), the three
 * steps are inferred from what the user actually does during the current pay
 * window:
 *   - Observe:  visited Transactions this cycle
 *   - Diagnose: visited Recurring this cycle
 *   - Decide:   added a commitment, or acknowledged "nothing to change"
 *
 * The durable source of truth is the server (PaySchedule.review — synced by
 * CycleVisitTracker and reset when the pay window rolls forward). localStorage
 * visit stamps are kept as a same-device complement so the checklist ticks
 * instantly on navigation, before the server round-trip lands.
 * Pure logic here is covered by `cycle-progress.test.ts`.
 */

/** Paths whose visits feed the Observe / Diagnose steps. */
export const CYCLE_TRACKED_PATHS = {
  observe: "/transactions",
  diagnose: "/recurring",
} as const;

const VISIT_KEY_PREFIX = "clarity:cycle-visit:";

function readLocal(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort: private mode / quota exhaustion just means no visit tracking.
  }
}

/** Record that the user visited `path` (call on route change). */
export function recordCycleVisit(path: string, now: Date = new Date()): void {
  writeLocal(VISIT_KEY_PREFIX + path, now.toISOString());
}

/** Last visit timestamp (ISO) for `path`, or null. */
export function getCycleVisit(path: string): string | null {
  return readLocal(VISIT_KEY_PREFIX + path);
}

/** True when an ISO visit timestamp falls on or after the cycle's start date. */
export function visitedThisCycle(visitIso: string | null, cycleStart: string | null): boolean {
  if (!visitIso || !cycleStart) return false;
  const visit = new Date(visitIso);
  const start = new Date(cycleStart + "T00:00:00");
  if (Number.isNaN(visit.getTime()) || Number.isNaN(start.getTime())) return false;
  return visit.getTime() >= start.getTime();
}

export type CycleStepInput = {
  cycleStart: string | null;
  /** Server-recorded signals (PaySchedule.review); durable across devices. */
  serverObserved: boolean;
  serverDiagnosed: boolean;
  /** Local visit stamps; instant on this device before the server catches up. */
  observedAt: string | null;
  diagnosedAt: string | null;
  decidedThisCycle: boolean;
};

export type CycleSteps = {
  observed: boolean;
  diagnosed: boolean;
  decided: boolean;
  doneCount: number;
  allDone: boolean;
};

export function deriveCycleSteps(input: CycleStepInput): CycleSteps {
  const observed = input.serverObserved || visitedThisCycle(input.observedAt, input.cycleStart);
  const diagnosed = input.serverDiagnosed || visitedThisCycle(input.diagnosedAt, input.cycleStart);
  const decided = Boolean(input.decidedThisCycle);
  const doneCount = [observed, diagnosed, decided].filter(Boolean).length;
  return { observed, diagnosed, decided, doneCount, allDone: doneCount === 3 };
}
