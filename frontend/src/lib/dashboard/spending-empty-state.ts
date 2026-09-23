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
 * The count it was given, though, was every uncategorized transaction ever,
 * of either sign -- so a single stray deposit from March explained away an
 * empty two-week pay window, and categorizing it would have changed nothing.
 * The backlog is only the reason when some of it is inside the window.
 *
 * Pure so the wording and the action are tested without rendering the card.
 */

export interface SpendingEmptyState {
  description: string;
  /** Render a "Categorize" affordance pointing at the uncategorized filter. */
  showCategorizeAction: boolean;
}

export interface UncategorizedCounts {
  /** Uncategorized transactions dated inside the window being charted. */
  inWindow: number;
  /** Uncategorized transactions anywhere, the window included. */
  total: number;
}

export function spendingEmptyState(counts: UncategorizedCounts): SpendingEmptyState {
  const { inWindow, total } = counts;

  if (inWindow > 0) {
    return {
      description:
        `${inWindow} transaction${inWindow === 1 ? "" : "s"} in this window still ` +
        `need${inWindow === 1 ? "s" : ""} a category. Spending is grouped by ` +
        `category, so anything without one is missing from this chart.`,
      showCategorizeAction: true,
    };
  }

  if (total > 0) {
    // The backlog is real but sits outside this window, so it is not why the
    // chart is empty -- worth mentioning, not worth blaming.
    return {
      description:
        `No categorized spending in this window. ${total} older transaction` +
        `${total === 1 ? "" : "s"} still need${total === 1 ? "s" : ""} a category.`,
      showCategorizeAction: true,
    };
  }

  return {
    description: "No spending in this window yet.",
    showCategorizeAction: false,
  };
}
