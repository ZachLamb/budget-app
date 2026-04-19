/** Values from HTML `<input type="date" />` and the pay-schedule API (`YYYY-MM-DD`). */
export type IsoDateString = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function lastDayOfCalendarMonth(year: number, month1To12: number): number {
  return new Date(year, month1To12, 0).getDate();
}

/**
 * True when the date works as a semi-monthly anchor.
 * Accepts the 1st (1-and-15 cadence), the 15th, or the last calendar day
 * of the month (15-and-last cadence). Users on a 1-and-15 schedule should
 * record the 1st as their last pay date — recording the 15th defaults to
 * the 15-and-last stepping.
 */
export function isSemiMonthlyPayAnchor(iso: IsoDateString): boolean {
  const m = ISO_DATE.exec(iso.trim());
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  if (!y || !mo || !day) return false;
  const last = lastDayOfCalendarMonth(y, mo);
  return day === 1 || day === 15 || day === last;
}

export function payFrequencyNeedsLastPaydate(freq: string | null | undefined): boolean {
  if (!freq) return false;
  return (
    freq === "weekly" ||
    freq === "biweekly" ||
    freq === "monthly" ||
    freq === "semimonthly"
  );
}
