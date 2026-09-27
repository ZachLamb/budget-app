/**
 * Reading a paystub.
 *
 * A stub prints two columns of the same figures -- what this check paid,
 * and the year-to-date total beside it. Confusing them is the mistake a
 * model makes here, and it is invisible in the result: every figure is
 * real and present on the document, just in the wrong column. Read
 * backwards, a September stub projects a year's tax from one paycheck's
 * withholding.
 *
 * So the pairing is the check. Year-to-date cannot be smaller than the
 * period inside it, and a pair that says otherwise is dropped rather
 * than shown. Per-figure believability is `./verify`'s job.
 */
import {
  dropField,
  verifyQuotedFields,
  type VerifiedFields,
} from "./verify";

export type { ExtractedField } from "./verify";

/** Pairs are ordered the way they appear on a stub. */
export const PAYSTUB_PAIRS = [
  { label: "Gross pay", now: "gross", ytd: "gross_ytd" },
  { label: "Federal tax withheld", now: "federal_withheld", ytd: "federal_withheld_ytd" },
  { label: "State tax withheld", now: "state_withheld", ytd: "state_withheld_ytd" },
  { label: "Social Security withheld", now: "ss_withheld", ytd: "ss_withheld_ytd" },
  { label: "Medicare withheld", now: "medicare_withheld", ytd: "medicare_withheld_ytd" },
  { label: "401(k)", now: "pretax_401k", ytd: "pretax_401k_ytd" },
  { label: "HSA", now: "pretax_hsa", ytd: "pretax_hsa_ytd" },
] as const;

export type PaystubKey = (typeof PAYSTUB_PAIRS)[number]["now" | "ytd"];

export const PAYSTUB_KEYS: readonly PaystubKey[] = PAYSTUB_PAIRS.flatMap(
  (p) => [p.now, p.ytd] as PaystubKey[],
);

export const PAYSTUB_LABELS = Object.fromEntries(
  PAYSTUB_PAIRS.flatMap((p) => [
    [p.now, `${p.label} (this check)`],
    [p.ytd, `${p.label} (year to date)`],
  ]),
) as Record<PaystubKey, string>;

export interface PaystubExtraction extends VerifiedFields<PaystubKey> {
  /** ISO date printed on the stub, or null if it could not be read. */
  payDate: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readPayDate(raw: unknown, today: Date = new Date()): string | null {
  if (typeof raw !== "string" || !ISO_DATE.test(raw)) return null;
  const parsed = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  // A stub dated in the future, or before payroll software existed, is a
  // misread -- and a wrong pay date silently changes the projection.
  if (parsed > today) return null;
  if (parsed.getFullYear() < 2000) return null;
  return raw;
}

export function verifyPaystub(
  raw: unknown,
  documentText: string,
  today: Date = new Date(),
): PaystubExtraction {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    ...verifyQuotedFields(raw, PAYSTUB_KEYS, PAYSTUB_LABELS, documentText),
    payDate: readPayDate(obj.pay_date, today),
  };
}

/** Rounding on a stub is to the cent; allow for it and nothing more. */
const CENT = 0.005;

export function applyPaystubCrossChecks(extraction: PaystubExtraction): PaystubExtraction {
  let out: VerifiedFields<PaystubKey> = extraction;

  const drop = (key: PaystubKey, why: string) => {
    out = dropField(out, key, PAYSTUB_LABELS[key], why);
  };
  const valueOf = (key: PaystubKey) => out.fields[key]?.value;

  for (const pair of PAYSTUB_PAIRS) {
    const now = valueOf(pair.now);
    const ytd = valueOf(pair.ytd);

    if (now !== undefined && now < -CENT) {
      drop(pair.now, "a paystub figure cannot be negative");
    }
    if (ytd !== undefined && ytd < -CENT) {
      drop(pair.ytd, "a paystub figure cannot be negative");
    }
    if (now === undefined || ytd === undefined) continue;

    // The column swap. Both figures are real, so neither can be trusted
    // over the other -- drop the pair and let the user type two numbers
    // rather than silently keep the wrong one.
    if (ytd + CENT < now) {
      drop(pair.now, "this check came out larger than the year-to-date total beside it, so the two columns may have been read the wrong way round");
      drop(pair.ytd, "the year-to-date total came out smaller than this one check, so the two columns may have been read the wrong way round");
    }
  }

  // Withholding is taken out of gross pay, so it cannot exceed it.
  const grossYtd = valueOf("gross_ytd");
  if (grossYtd !== undefined && grossYtd > 0) {
    const deductions: PaystubKey[] = [
      "federal_withheld_ytd",
      "state_withheld_ytd",
      "ss_withheld_ytd",
      "medicare_withheld_ytd",
      "pretax_401k_ytd",
      "pretax_hsa_ytd",
    ];
    for (const key of deductions) {
      const amount = valueOf(key);
      if (amount !== undefined && amount > grossYtd + CENT) {
        drop(key, "it came out larger than gross pay for the year, which cannot happen");
      }
    }
  }

  return { ...out, payDate: extraction.payDate };
}

/**
 * Figures that look wrong but cannot be proven wrong.
 *
 * Social Security and Medicare are fixed percentages of pay, so a figure
 * far off those rates is almost certainly a misread line -- but "almost
 * certainly" is not grounds for throwing away something the document
 * really does say. These are shown as doubts next to the figure instead.
 */
export function payrollTaxDoubts(extraction: PaystubExtraction): string[] {
  const doubts: string[] = [];
  const gross = extraction.fields.gross_ytd?.value;
  if (gross === undefined || gross <= 0) return doubts;

  const check = (key: PaystubKey, rate: number, name: string) => {
    const amount = extraction.fields[key]?.value;
    if (amount === undefined) return;
    const expected = gross * rate;
    // Wide band: the Social Security wage cap, mid-year job changes and
    // pre-tax deductions all move the real ratio legitimately.
    if (amount > expected * 1.25 || amount < expected * 0.5) {
      doubts.push(
        `${name} year-to-date is ${(amount / gross * 100).toFixed(2)}% of gross pay; ${(rate * 100).toFixed(2)}% is the usual rate. Worth a second look.`,
      );
    }
  };

  check("ss_withheld_ytd", 0.062, "Social Security");
  check("medicare_withheld_ytd", 0.0145, "Medicare");
  return doubts;
}
