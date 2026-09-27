/**
 * Payroll tax rates, for sanity checks only.
 *
 * The engine's rate tables are the authority on what tax is owed; these
 * exist so a reader can say "that figure is nowhere near the usual rate,
 * look again". They are never used to compute anything a user is shown as
 * a result.
 *
 * Kept in one place because this app has twice been bitten by the same
 * shape of bug: a limit fixed in one spot while a second copy quietly
 * kept the old value.
 */

export const SOCIAL_SECURITY_RATE = 0.062;
export const MEDICARE_RATE = 0.0145;

/**
 * How far off a rate a figure can sit before it is worth a second look.
 *
 * Wide on purpose. The Social Security wage cap, a mid-year job change and
 * pre-tax deductions all move the real ratio without anything being wrong,
 * and a doubt that fires on correct documents teaches people to ignore it.
 */
export const RATE_TOLERANCE = { low: 0.5, high: 1.25 } as const;

/** A figure that is nowhere near the rate it should follow. */
export function rateLooksWrong(amount: number, base: number, rate: number): boolean {
  if (base <= 0) return false;
  const expected = base * rate;
  return amount > expected * RATE_TOLERANCE.high || amount < expected * RATE_TOLERANCE.low;
}
