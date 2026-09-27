/**
 * Reading a W-2.
 *
 * The most reliably parsed tax document there is: numbered boxes with
 * fixed meanings, issued as a text PDF by every payroll provider. What
 * makes it worth careful cross-checking anyway is that its boxes are
 * *related* -- box 4 is a fixed percentage of box 3, box 5 can never be
 * below box 3 -- so a misread box usually contradicts a correctly read
 * one, and the contradiction is findable.
 *
 * Every hard check below is a structural fact about the form, true in any
 * tax year. The rate-based checks are doubts rather than rejections, and
 * borrow their rates from `./fica`, which says plainly that the engine is
 * the authority on rates.
 */
import { MEDICARE_RATE, SOCIAL_SECURITY_RATE, rateLooksWrong } from "./fica";
import {
  dropField,
  verifyQuotedFields,
  type VerifiedFields,
} from "./verify";

export type { ExtractedField } from "./verify";

export const W2_KEYS = [
  "wages",
  "federal_withheld",
  "ss_wages",
  "ss_withheld",
  "medicare_wages",
  "medicare_withheld",
  "pretax_401k",
  "pretax_hsa",
  "state_wages",
  "state_withheld",
] as const;

export type W2Key = (typeof W2_KEYS)[number];

/** Box numbers, shown so each figure can be checked by eye. */
export const W2_BOXES: Record<W2Key, string> = {
  wages: "Box 1",
  federal_withheld: "Box 2",
  ss_wages: "Box 3",
  ss_withheld: "Box 4",
  medicare_wages: "Box 5",
  medicare_withheld: "Box 6",
  pretax_401k: "Box 12, code D",
  pretax_hsa: "Box 12, code W",
  state_wages: "Box 16",
  state_withheld: "Box 17",
};

export const W2_LABELS: Record<W2Key, string> = {
  wages: "Wages, tips, other compensation",
  federal_withheld: "Federal income tax withheld",
  ss_wages: "Social Security wages",
  ss_withheld: "Social Security tax withheld",
  medicare_wages: "Medicare wages and tips",
  medicare_withheld: "Medicare tax withheld",
  pretax_401k: "401(k) deferral",
  pretax_hsa: "HSA contribution",
  state_wages: "State wages",
  state_withheld: "State income tax withheld",
};

export type W2Extraction = VerifiedFields<W2Key>;

export function verifyW2(raw: unknown, documentText: string): W2Extraction {
  return verifyQuotedFields(raw, W2_KEYS, W2_LABELS, documentText);
}

/** Rounding on a W-2 is to the cent; allow for it and nothing more. */
const CENT = 0.005;

/**
 * Contradictions between boxes, every one of them year-independent.
 *
 * A withholding box can never exceed the wage box it is computed from,
 * and Medicare wages can never fall below Social Security wages -- Social
 * Security stops at a cap that Medicare does not have, so box 5 is the
 * larger of the two or they are equal. When a pair is impossible and
 * neither figure can be blamed, both go, the way a swapped paystub column
 * does: keeping the wrong one is worse than typing two numbers.
 */
export function applyW2CrossChecks(extraction: W2Extraction): W2Extraction {
  let out: W2Extraction = extraction;
  const drop = (key: W2Key, why: string) => {
    out = dropField(out, key, W2_LABELS[key], why);
  };
  const valueOf = (key: W2Key) => out.fields[key]?.value;

  for (const key of W2_KEYS) {
    const value = valueOf(key);
    if (value !== undefined && value < -CENT) {
      drop(key, "a W-2 box cannot be negative");
    }
  }

  // A tax withheld cannot exceed the wages it was withheld from.
  const pairs: [W2Key, W2Key][] = [
    ["federal_withheld", "wages"],
    ["ss_withheld", "ss_wages"],
    ["medicare_withheld", "medicare_wages"],
    ["state_withheld", "state_wages"],
  ];
  for (const [tax, wages] of pairs) {
    const t = valueOf(tax);
    const w = valueOf(wages);
    if (t !== undefined && w !== undefined && t > w + CENT) {
      drop(tax, `it came out larger than ${W2_LABELS[wages].toLowerCase()}, which cannot happen`);
    }
  }

  // Medicare has no wage cap and Social Security does, so box 5 is never
  // the smaller of the two. Read the wrong way round they look ordinary.
  const ssWages = valueOf("ss_wages");
  const medicareWages = valueOf("medicare_wages");
  if (ssWages !== undefined && medicareWages !== undefined && medicareWages + CENT < ssWages) {
    drop("ss_wages", "Social Security wages came out above Medicare wages, which cannot happen — boxes 3 and 5 may have been read the wrong way round");
    drop("medicare_wages", "Medicare wages came out below Social Security wages, which cannot happen — boxes 3 and 5 may have been read the wrong way round");
  }

  return out;
}

/**
 * Figures that look wrong but cannot be proven wrong.
 *
 * Box 1 is net of pre-tax deferrals while boxes 3 and 5 are not, so
 * box 1 plus the 401(k) deferral should land near box 5. "Near" is as
 * far as it goes: group term life, other deferrals and a dozen rarer
 * items all move it legitimately.
 */
export function w2Doubts(extraction: W2Extraction): string[] {
  const doubts: string[] = [];
  const get = (key: W2Key) => extraction.fields[key]?.value;

  const ssWages = get("ss_wages");
  const ssTax = get("ss_withheld");
  if (ssWages !== undefined && ssTax !== undefined && rateLooksWrong(ssTax, ssWages, SOCIAL_SECURITY_RATE)) {
    doubts.push(
      `Box 4 is ${((ssTax / ssWages) * 100).toFixed(2)}% of box 3; ${(SOCIAL_SECURITY_RATE * 100).toFixed(2)}% is the rate. Worth a second look.`,
    );
  }

  const medicareWages = get("medicare_wages");
  const medicareTax = get("medicare_withheld");
  // Only a figure BELOW the rate is suspect. Above it is ordinary: the
  // additional Medicare tax adds 0.9% on high earnings.
  if (
    medicareWages !== undefined &&
    medicareTax !== undefined &&
    medicareWages > 0 &&
    medicareTax < medicareWages * MEDICARE_RATE * 0.5
  ) {
    doubts.push(
      `Box 6 is ${((medicareTax / medicareWages) * 100).toFixed(2)}% of box 5, well under the ${(MEDICARE_RATE * 100).toFixed(2)}% rate. Worth a second look.`,
    );
  }

  const wages = get("wages");
  const deferral = get("pretax_401k");
  if (wages !== undefined && deferral !== undefined && medicareWages !== undefined && deferral > 0) {
    const expected = wages + deferral;
    if (Math.abs(expected - medicareWages) > Math.max(medicareWages * 0.02, 50)) {
      doubts.push(
        "Box 1 plus the 401(k) deferral does not come close to box 5. One of the three may be misread.",
      );
    }
  }

  return doubts;
}
