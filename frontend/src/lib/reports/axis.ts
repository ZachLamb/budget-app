/**
 * Chart axis tick labels.
 *
 * The reports charts used to format Y ticks two different wrong ways:
 * `$${(v / 1000).toFixed(0)}k`, which collapses every value under $1,000
 * to "$0k" and renders 6000/4500/3000/1500 as the uneven-looking
 * "$6k/$5k/$3k/$2k"; and the full `formatCurrency`, whose "-$5,500.00" is
 * wider than recharts' default 60px axis and gets clipped to ",500.00".
 *
 * One formatter, sized to fit, that keeps small amounts legible.
 */

const UNITS: { limit: number; divisor: number; suffix: string }[] = [
  { limit: 1_000_000_000, divisor: 1_000_000_000, suffix: "B" },
  { limit: 1_000_000, divisor: 1_000_000, suffix: "M" },
  { limit: 1_000, divisor: 1_000, suffix: "k" },
];

/** Widest label this can produce, in px, at the charts' text-xs size. */
export const CURRENCY_AXIS_WIDTH = 64;

export function compactCurrencyTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  const unit = UNITS.find((u) => abs >= u.limit);
  if (!unit) {
    // Under a thousand the exact dollar is short enough to show, and it is
    // the range where rounding to "k" destroys the whole chart.
    return `${sign}$${Math.round(abs)}`;
  }

  const scaled = abs / unit.divisor;
  // One decimal below 10 ("$1.2k"), none above ("$12k") -- keeps every tick
  // the same handful of characters wide.
  const digits = scaled < 10 ? 1 : 0;
  const text = scaled.toFixed(digits).replace(/\.0$/, "");
  return `${sign}$${text}${unit.suffix}`;
}
