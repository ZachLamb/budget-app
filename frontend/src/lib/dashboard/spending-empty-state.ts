/**
 * What the Dashboard's spending card should say when it has nothing to plot.
 *
 * "No spending in this window yet." is right only when there is genuinely
 * nothing there. On a live account with 189 transactions, none categorized, it
 * was actively misleading: spending-by-category groups by category, so an
 * uncategorized backlog returns zero rows and the card claimed there had been
 * no spending. Budget ACTIVITY reads 0 for the same reason, so the whole app
 * looks empty and nothing tells you why.
 *
 * Pure so the wording and the action are tested without rendering the card.
 */

export interface SpendingEmptyState {
  description: string;
  /** Render a "Categorize" affordance pointing at the uncategorized filter. */
  showCategorizeAction: boolean;
}

export function spendingEmptyState(uncategorizedCount: number): SpendingEmptyState {
  if (uncategorizedCount > 0) {
    const n = uncategorizedCount;
    return {
      description:
        `${n} transaction${n === 1 ? " is" : "s are"} waiting to be categorized. ` +
        `Spending is grouped by category, so this chart stays empty until ${n === 1 ? "it has" : "they have"} one.`,
      showCategorizeAction: true,
    };
  }
  return {
    description: "No spending in this window yet.",
    showCategorizeAction: false,
  };
}
