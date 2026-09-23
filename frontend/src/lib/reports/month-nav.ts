/**
 * Month navigation for the spending report.
 *
 * Forward navigation used to run on forever. Nothing stopped you walking
 * into 2031, and every month past this one showed "No spending this
 * month -- add and categorize transactions", which reads as a reproach
 * for something you did wrong rather than the truth: that month has not
 * happened yet.
 */
import { formatMonthDisplay, getMonthString } from "@/lib/format";

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-");
  return getMonthString(new Date(Number(y), Number(m) - 1 + delta));
}

/** The latest month worth showing: no report can exist for a future one. */
export function latestReportableMonth(today: Date = new Date()): string {
  return getMonthString(today);
}

export function canGoForward(month: string, today: Date = new Date()): boolean {
  return month < latestReportableMonth(today);
}

export type SpendingEmptyMonth = {
  title: string;
  description: string;
  /** A month that does have spending, offered as a one-click jump. */
  jumpTo: string | null;
  jumpLabel: string | null;
};

/**
 * What to say when the selected month has no spending.
 *
 * `monthsWithSpending` comes from the trend data the page already loads,
 * so the empty state can name a month that actually has something in it
 * instead of sending everyone to the import screen.
 */
export function spendingEmptyMonth(
  month: string,
  monthsWithSpending: string[],
  today: Date = new Date(),
): SpendingEmptyMonth {
  const past = monthsWithSpending.filter((m) => m <= latestReportableMonth(today)).sort();
  const mostRecent = past.length > 0 ? past[past.length - 1] : null;

  if (mostRecent === null) {
    return {
      title: "No spending recorded yet",
      description:
        "Import or add transactions and give them categories — spending is grouped by category, so both steps are needed before this chart fills in.",
      jumpTo: null,
      jumpLabel: null,
    };
  }

  const label = formatMonthDisplay(month);
  const jumpLabel = formatMonthDisplay(mostRecent);

  if (month > latestReportableMonth(today)) {
    return {
      title: `${label} hasn't happened yet`,
      description: `Nothing has been spent in a month that is still in the future. Your most recent spending was in ${jumpLabel}.`,
      jumpTo: mostRecent,
      jumpLabel,
    };
  }

  if (month === mostRecent) {
    // The month we would jump to is the one already open.
    return {
      title: `No spending in ${label}`,
      description:
        "Transactions in this month are all uncategorized, or there are none. Spending is grouped by category, so it needs one to appear here.",
      jumpTo: null,
      jumpLabel: null,
    };
  }

  return {
    title: `No spending in ${label}`,
    description: `Nothing categorized landed in this month. Your most recent spending was in ${jumpLabel}.`,
    jumpTo: mostRecent,
    jumpLabel,
  };
}
