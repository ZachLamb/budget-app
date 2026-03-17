export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/** Format as negative currency (e.g. -$500). Use for debt/liability/expense display so the minus is always visible. */
export function formatCurrencyNegative(amount: number) {
  const value = typeof amount === "number" && amount > 0 ? -amount : amount;
  return formatCurrency(value);
}

export function getMonthString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthDisplay(month: string): string {
  const [year, m] = month.split("-");
  const date = new Date(Number(year), Number(m) - 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function navigateMonth(month: string, delta: number): string {
  const [year, m] = month.split("-");
  const date = new Date(Number(year), Number(m) - 1 + delta);
  return getMonthString(date);
}

export function formatShortMonth(month: string): string {
  const [y, mo] = month.split("-");
  return new Date(Number(y), Number(mo) - 1).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
  });
}
