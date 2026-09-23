/**
 * What "Export CSV" on the Reports page should actually export.
 *
 * The button used to call the export endpoint with no arguments at all,
 * so someone looking at August's spending, or one account's balance
 * history, downloaded every transaction they have ever had under the
 * name `transactions.csv`. The endpoint has taken a date range and an
 * account id all along -- this works out which of them the view on
 * screen implies.
 */

export type ReportTab = "spending" | "trends" | "balances" | "imports";

export type ExportScope = {
  params: { account_id?: string; date_from?: string; date_to?: string };
  filename: string;
  /** Plain-language description of what is about to be downloaded. */
  label: string;
};

/** First and last calendar day of a `YYYY-MM` month. */
export function monthRange(month: string): { date_from: string; date_to: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    date_from: `${month}-01`,
    date_to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function exportScope(input: {
  tab: ReportTab;
  month: string;
  /** Months currently charted on the Trends tab, oldest first. */
  trendMonths: string[];
  accountId: string;
  accountName: string;
}): ExportScope {
  if (input.tab === "spending") {
    const range = monthRange(input.month);
    return {
      params: range,
      filename: `transactions-${input.month}.csv`,
      label: `transactions in ${input.month}`,
    };
  }

  if (input.tab === "trends" && input.trendMonths.length > 0) {
    const first = input.trendMonths[0];
    const last = input.trendMonths[input.trendMonths.length - 1];
    return {
      params: { date_from: monthRange(first).date_from, date_to: monthRange(last).date_to },
      filename: `transactions-${first}-to-${last}.csv`,
      label: `transactions from ${first} to ${last}`,
    };
  }

  if (input.tab === "balances" && input.accountId) {
    return {
      params: { account_id: input.accountId },
      filename: `transactions-${slug(input.accountName) || "account"}.csv`,
      label: `transactions in ${input.accountName}`,
    };
  }

  return { params: {}, filename: "transactions.csv", label: "all transactions" };
}
