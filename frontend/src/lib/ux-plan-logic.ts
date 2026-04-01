/**
 * Pure helpers for UX plan behaviors (sync banner, charts, setup checklist).
 * Covered by TDD in `ux-plan-logic.test.ts`.
 */

export const CHART_FALLBACK = [
  "oklch(0.646 0.222 41.116)",
  "oklch(0.6 0.118 184.704)",
  "oklch(0.398 0.07 227.392)",
  "oklch(0.828 0.189 84.429)",
  "oklch(0.769 0.188 70.08)",
] as const;

export type LastSyncLike = {
  status: string;
  completed_at?: string | null;
  error_message?: string | null;
} | null;

/** Mobile banner: show when last completed sync did not fully succeed. */
export function shouldShowMobileSyncBanner(last: LastSyncLike | undefined): boolean {
  if (!last?.completed_at) return false;
  if (last.status === "success" || last.status === "in_progress") return false;
  return true;
}

export type MobileDataBarKind = "syncing" | "problem" | "stale";

/**
 * Single mobile status strip: syncing > sync problem > stale.
 * When null, no strip (last sync success and not stale, or no data yet).
 */
export function resolveMobileDataBarKind(
  syncing: boolean,
  isStale: boolean,
  last: LastSyncLike | undefined,
): MobileDataBarKind | null {
  if (syncing) return "syncing";
  if (shouldShowMobileSyncBanner(last)) return "problem";
  if (isStale) return "stale";
  return null;
}

/** Map Recharts slice index → theme --chart-n with fallback (cycles 1..5). */
export function resolveChartSeriesColors(
  max: number,
  readCssVar: (name: string) => string,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const n = (i % 5) + 1;
    const raw = readCssVar(`--chart-${n}`).trim();
    out.push(raw || CHART_FALLBACK[i % CHART_FALLBACK.length]);
  }
  return out;
}

export type SetupStepInput = {
  accountCount: number;
  transactionTotal: number;
  budgetAssigned: number;
  simplefinConfigured: boolean;
};

export type SetupStep = {
  id: string;
  label: string;
  href: string;
  optional?: boolean;
  done: boolean;
};

export function buildSetupSteps(input: SetupStepInput): SetupStep[] {
  return [
    {
      id: "account",
      label: "Add at least one account",
      done: input.accountCount > 0,
      href: "/accounts",
    },
    {
      id: "txns",
      label: "Import or sync transactions",
      done: input.transactionTotal > 0,
      href: "/transactions",
    },
    {
      id: "budget",
      label: "Assign money in this month’s budget",
      done: input.budgetAssigned > 0,
      href: "/budget",
    },
    {
      id: "bank",
      label: "Connect bank (SimpleFIN, optional)",
      done: input.simplefinConfigured,
      href: "/settings",
      optional: true,
    },
  ];
}

export function isCoreSetupComplete(steps: Pick<SetupStep, "optional" | "done">[]): boolean {
  return steps.filter((s) => !s.optional).every((s) => s.done);
}
