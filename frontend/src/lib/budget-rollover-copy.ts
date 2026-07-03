import { formatCurrency, formatMonthDisplay, navigateMonth } from "@/lib/format";

/** "Includes +$25.00 carried from June 2026" — null when nothing carried. */
export function carryoverNote(carryover: number, month: string): string | null {
  if (carryover <= 0) return null;
  return `Includes +${formatCurrency(carryover)} carried from ${formatMonthDisplay(navigateMonth(month, -1))}`;
}

/** Shown while the viewed month itself is overspent (available < 0). */
export function overspendNote(available: number): string | null {
  if (available >= 0) return null;
  return "Overspent — will reduce next month's Ready to Assign";
}

/** Ready to Assign card subtext for clipped prior-month overspend. */
export function rtaDeductionNote(overspendDeducted: number): string | null {
  if (overspendDeducted <= 0) return null;
  return `Includes −${formatCurrency(overspendDeducted)} prior overspend`;
}
