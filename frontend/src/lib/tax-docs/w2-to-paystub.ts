/**
 * Turning a W-2 into the year-end figures the projection runs on.
 *
 * A Paystub row in this app is a snapshot of year-to-date figures at a
 * date. A W-2 is exactly that snapshot, taken on 31 December — which is
 * why this needs no new storage and no new engine path. It is for the
 * people who never keep a paystub but always have the W-2, and for
 * closing out a year against what actually happened rather than what was
 * projected.
 *
 * ## The one derived figure
 *
 * A W-2 does not print gross pay. It prints what is left after various
 * pre-tax deductions, in three different combinations:
 *
 *     box 1 (federal wages)  = gross − section 125 − 401(k)
 *     box 5 (Medicare wages) = gross − section 125
 *
 * "Section 125" is the pre-tax bucket: HSA, FSA, and — the one that
 * matters here — health insurance premiums. Box 12 code W gives the HSA
 * part. Nothing on the form gives the premiums.
 *
 * So `gross = box 5 + HSA` is a LOWER bound whenever someone pays for
 * health cover pre-tax, which is most people.
 *
 * That sounds like it should poison the estimate. It does not, and the
 * reason is worth writing down. The engine does this:
 *
 *     fica_wages       = gross − pretax_hsa − pretax_other
 *     income_tax_wages = fica_wages − pretax_401k
 *
 * Feed it `gross = box5 + HSA`, `pretax_hsa = HSA`, `pretax_other = 0`:
 *
 *     fica_wages       = box5                 ← exactly right
 *     income_tax_wages = box5 − 401(k) = box1 ← exactly right
 *
 * Both figures that drive tax land on the numbers the W-2 actually
 * prints. The understatement lives only in the headline "gross", which
 * the engine uses for one thing: the effective-rate denominator. That is
 * said plainly in the notes rather than left to be discovered.
 */

import type { PaystubKey } from "./paystub-extract";
import type { W2Extraction, W2Key } from "./w2-extract";

/** W-2 rounding is to the cent; allow for that and nothing more. */
const CENT = 0.005;

/** Boxes that are the same figure under a different name. */
const DIRECT: [W2Key, PaystubKey][] = [
  ["federal_withheld", "federal_withheld_ytd"],
  ["state_withheld", "state_withheld_ytd"],
  ["ss_withheld", "ss_withheld_ytd"],
  ["medicare_withheld", "medicare_withheld_ytd"],
  ["pretax_401k", "pretax_401k_ytd"],
  ["pretax_hsa", "pretax_hsa_ytd"],
];

export interface W2Derivation {
  /** Year-to-date figures, ready for the paystub form. */
  values: Partial<Record<PaystubKey, number>>;
  /** 31 December of the W-2's year, or null if the year is unknown. */
  payDate: string | null;
  /** What was worked out rather than copied, and what that costs. */
  notes: string[];
  /** Set when no usable year-end entry can be made, and why. */
  blocked: string | null;
}

function value(extraction: W2Extraction, key: W2Key): number | undefined {
  return extraction.fields[key]?.value;
}

/**
 * Derive year-end paystub figures from a verified W-2.
 *
 * `year` is supplied rather than read from the form: the boxes are what
 * this reader is good at, and a misread year would silently file a whole
 * year of figures against the wrong one.
 */
export function deriveYearEndFigures(
  extraction: W2Extraction,
  year: number | null,
): W2Derivation {
  const values: Partial<Record<PaystubKey, number>> = {};
  const notes: string[] = [];

  for (const [from, to] of DIRECT) {
    const v = value(extraction, from);
    if (v !== undefined) values[to] = v;
  }

  const box1 = value(extraction, "wages");
  const box5 = value(extraction, "medicare_wages");
  const k401 = value(extraction, "pretax_401k") ?? 0;
  const hsa = value(extraction, "pretax_hsa") ?? 0;

  // Box 5 is the better base: it is gross less section 125 only, so
  // adding the HSA back gets closest to gross. Box 1 has the 401(k)
  // taken out as well, so it needs that added back too.
  let base: number | undefined;
  if (box5 !== undefined) {
    base = box5;
  } else if (box1 !== undefined) {
    base = box1 + k401;
    notes.push(
      "Box 5 (Medicare wages) was not read, so gross pay was worked out " +
        "from box 1 plus your 401(k) instead.",
    );
  }

  if (base === undefined) {
    return {
      values,
      payDate: null,
      notes,
      blocked:
        "Neither box 1 nor box 5 could be read, so there is no wages figure " +
        "to build a year from. Enter the figures by hand instead.",
    };
  }

  // box 1 + 401(k) must equal box 5. When it does not, one of the three
  // was misread, and a gross derived from any of them would be wrong in
  // a way nothing downstream could detect.
  if (box1 !== undefined && box5 !== undefined) {
    if (Math.abs(box1 + k401 - box5) > CENT) {
      return {
        values,
        payDate: null,
        notes,
        blocked:
          "Box 1 plus your 401(k) does not come to box 5, so at least one " +
          "of them was read wrong. Check those three boxes on the form and " +
          "enter the figures by hand.",
      };
    }
  }

  values.gross_ytd = round2(base + hsa);

  if (hsa > 0) {
    notes.push(
      "Gross pay is not printed on a W-2, so it was worked out from your " +
        "Medicare wages plus your HSA contributions.",
    );
  } else {
    notes.push(
      "Gross pay is not printed on a W-2, so your Medicare wages were used " +
        "for it.",
    );
  }

  // Said out loud because it is the one place this is approximate, and
  // because "my gross looks low" is otherwise a mystery.
  notes.push(
    "If you pay for health cover out of your pay before tax, that amount " +
      "is not on a W-2 anywhere, so the gross above reads a little low. " +
      "The tax worked out from it is not affected — only the effective " +
      "rate shown alongside it.",
  );

  return {
    values,
    // A W-2 covers a whole year, so the snapshot it describes is the one
    // taken on the last day of it.
    payDate: year === null ? null : `${year}-12-31`,
    notes,
    blocked: null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
