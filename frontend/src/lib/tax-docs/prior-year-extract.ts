/**
 * Reading last year's return out of a 1040 PDF.
 *
 * Which figures to look for, and what makes a set of them impossible.
 * Whether any individual figure is believable at all is `./verify`'s job.
 */
import {
  dropField,
  verifyQuotedFields,
  type VerifiedFields,
} from "./verify";

export type { ExtractedField } from "./verify";

export const PRIOR_YEAR_KEYS = [
  "agi",
  "taxable_income",
  "total_tax",
  "total_withheld",
] as const;

export type PriorYearKey = (typeof PRIOR_YEAR_KEYS)[number];

/** Form 1040 line numbers, shown so the figure can be checked by eye. */
export const FORM_LINES: Record<PriorYearKey, string> = {
  agi: "Form 1040 line 11",
  taxable_income: "Form 1040 line 15",
  total_tax: "Form 1040 line 24",
  total_withheld: "Form 1040 line 25d",
};

export const FIELD_LABELS: Record<PriorYearKey, string> = {
  agi: "Adjusted gross income",
  taxable_income: "Taxable income",
  total_tax: "Total tax owed",
  total_withheld: "Total withheld",
};

export interface PriorYearExtraction extends VerifiedFields<PriorYearKey> {
  year: number | null;
}

/**
 * Turn a model's raw JSON into figures that earned their place.
 *
 * `documentText` is the text the model was shown; a quote that is not in
 * it was not read from the document.
 */
export function verifyExtraction(
  raw: unknown,
  documentText: string,
  today: Date = new Date(),
): PriorYearExtraction {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    ...verifyQuotedFields(raw, PRIOR_YEAR_KEYS, FIELD_LABELS, documentText),
    year: readYear(obj.year, today),
  };
}

function readYear(raw: unknown, today: Date): number | null {
  const year = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(year)) return null;
  // A return exists for a year that has ended; anything else is a misread.
  if (year < 2000 || year > today.getFullYear()) return null;
  return year;
}

/**
 * Cross-checks between figures, applied after each one has been verified
 * on its own. A number can be quoted correctly and still be the wrong
 * line -- reading line 16 as line 24 is an easy mistake to make and an
 * expensive one to keep.
 */
export function applyCrossChecks(extraction: PriorYearExtraction): PriorYearExtraction {
  let out: VerifiedFields<PriorYearKey> = extraction;
  const drop = (key: PriorYearKey, why: string) => {
    out = dropField(out, key, FIELD_LABELS[key], why);
  };

  const agi = extraction.fields.agi?.value;
  const taxable = extraction.fields.taxable_income?.value;
  const totalTax = extraction.fields.total_tax?.value;
  const withheld = extraction.fields.total_withheld?.value;

  // Deductions only subtract, so taxable income cannot exceed AGI.
  if (agi !== undefined && taxable !== undefined && agi > 0 && taxable > agi) {
    drop("taxable_income", "it came out higher than adjusted gross income, which cannot happen");
  }
  if (totalTax !== undefined && totalTax < 0) {
    drop("total_tax", "total tax cannot be negative");
  }
  if (withheld !== undefined && withheld < 0) {
    drop("total_withheld", "withholding cannot be negative");
  }
  // Nobody pays more tax than they earned; that is a misread line.
  if (agi !== undefined && totalTax !== undefined && agi > 0 && totalTax > agi) {
    drop("total_tax", "it came out higher than the whole year's income");
  }

  return { ...out, year: extraction.year };
}
