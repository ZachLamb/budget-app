import { describe, it, expect } from "vitest";
import { deriveYearEndFigures } from "./w2-to-paystub";
import type { W2Extraction, W2Key } from "./w2-extract";

/** A verified extraction, built from plain numbers. */
function w2(boxes: Partial<Record<W2Key, number>>): W2Extraction {
  const fields = Object.fromEntries(
    Object.entries(boxes).map(([k, v]) => [
      k,
      { value: v, source_text: `${k} ${v}` },
    ]),
  );
  return { fields, dropped: [] } as unknown as W2Extraction;
}

/**
 * A realistic W-2 for someone on $100,000 who puts $8,000 into a 401(k),
 * $3,000 into an HSA, and pays $4,000 of health premiums before tax.
 *
 *   gross                  100,000
 *   section 125 (HSA+prem)  -7,000  → box 5 =  93,000
 *   401(k)                  -8,000  → box 1 =  85,000
 */
const REALISTIC = {
  wages: 85000,
  medicare_wages: 93000,
  ss_wages: 93000,
  pretax_401k: 8000,
  pretax_hsa: 3000,
  federal_withheld: 12000,
  state_withheld: 4092,
  ss_withheld: 5766,
  medicare_withheld: 1348.5,
} satisfies Partial<Record<W2Key, number>>;

describe("deriveYearEndFigures", () => {
  describe("boxes that are simply copied", () => {
    it("maps each withholding box to its year-to-date column", () => {
      const { values } = deriveYearEndFigures(w2(REALISTIC), 2025);
      expect(values.federal_withheld_ytd).toBe(12000);
      expect(values.state_withheld_ytd).toBe(4092);
      expect(values.ss_withheld_ytd).toBe(5766);
      expect(values.medicare_withheld_ytd).toBe(1348.5);
    });

    it("maps the two box 12 codes to their deferrals", () => {
      const { values } = deriveYearEndFigures(w2(REALISTIC), 2025);
      expect(values.pretax_401k_ytd).toBe(8000);
      expect(values.pretax_hsa_ytd).toBe(3000);
    });

    it("leaves a box that was not read out entirely", () => {
      // Absent, not zero. A missing state box is not a claim that no
      // state tax was withheld.
      const { values } = deriveYearEndFigures(
        w2({ ...REALISTIC, state_withheld: undefined }),
        2025,
      );
      expect("state_withheld_ytd" in values).toBe(false);
    });
  });

  describe("the derived gross", () => {
    it("adds the HSA back to Medicare wages", () => {
      // 93,000 + 3,000 = 96,000. Not the true 100,000 -- the 4,000 of
      // health premiums is nowhere on the form.
      const { values } = deriveYearEndFigures(w2(REALISTIC), 2025);
      expect(values.gross_ytd).toBe(96000);
    });

    it("lands the engine's FICA wages exactly on box 5", () => {
      // This is the whole justification for the derivation:
      //   fica_wages = gross - pretax_hsa - pretax_other
      const { values } = deriveYearEndFigures(w2(REALISTIC), 2025);
      const fica = values.gross_ytd! - values.pretax_hsa_ytd! - 0;
      expect(fica).toBe(REALISTIC.medicare_wages);
    });

    it("lands the engine's income-tax wages exactly on box 1", () => {
      //   income_tax_wages = fica_wages - pretax_401k
      const { values } = deriveYearEndFigures(w2(REALISTIC), 2025);
      const fica = values.gross_ytd! - values.pretax_hsa_ytd! - 0;
      expect(fica - values.pretax_401k_ytd!).toBe(REALISTIC.wages);
    });

    it("says gross was worked out, and what it misses", () => {
      const { notes } = deriveYearEndFigures(w2(REALISTIC), 2025);
      expect(notes.join(" ")).toMatch(/Gross pay is not printed on a W-2/);
      expect(notes.join(" ")).toMatch(/health cover/);
      expect(notes.join(" ")).toMatch(/only the effective rate/);
    });

    it("uses Medicare wages as-is when there is no HSA", () => {
      const { values } = deriveYearEndFigures(
        w2({ ...REALISTIC, pretax_hsa: undefined }),
        2025,
      );
      expect(values.gross_ytd).toBe(93000);
    });

    it("falls back to box 1 plus the 401(k) when box 5 is unreadable", () => {
      const { values, notes } = deriveYearEndFigures(
        w2({ ...REALISTIC, medicare_wages: undefined }),
        2025,
      );
      // 85,000 + 8,000 + 3,000 = 96,000 -- the same answer by a longer road.
      expect(values.gross_ytd).toBe(96000);
      expect(notes.join(" ")).toMatch(/Box 5 .* was not read/);
    });

    it("rounds to the cent", () => {
      const { values } = deriveYearEndFigures(
        w2({ medicare_wages: 93000.005, pretax_hsa: 0.005 }),
        2025,
      );
      expect(values.gross_ytd).toBe(93000.01);
    });
  });

  describe("when the boxes contradict each other", () => {
    it("refuses rather than deriving a gross from a misread box", () => {
      // box 1 + 401(k) must come to box 5. Here it does not, so one of
      // the three is wrong and nothing downstream could tell.
      const { blocked, values } = deriveYearEndFigures(
        w2({ ...REALISTIC, wages: 70000 }),
        2025,
      );
      expect(blocked).toMatch(/does not come to box 5/);
      expect(values.gross_ytd).toBeUndefined();
    });

    it("still hands back the boxes it did read", () => {
      // The withholding figures are independently verified; throwing
      // them away because the wages disagree helps nobody.
      const { values } = deriveYearEndFigures(
        w2({ ...REALISTIC, wages: 70000 }),
        2025,
      );
      expect(values.federal_withheld_ytd).toBe(12000);
    });

    it("tolerates rounding of a cent", () => {
      const { blocked } = deriveYearEndFigures(
        w2({ ...REALISTIC, wages: 85000.004 }),
        2025,
      );
      expect(blocked).toBeNull();
    });

    it("refuses when neither wages box could be read", () => {
      const { blocked } = deriveYearEndFigures(
        w2({ federal_withheld: 12000 }),
        2025,
      );
      expect(blocked).toMatch(/Neither box 1 nor box 5/);
    });

    it("does not check the pair when only one of them was read", () => {
      // One box missing is not a contradiction.
      const { blocked, values } = deriveYearEndFigures(
        w2({ medicare_wages: 93000, pretax_401k: 8000, pretax_hsa: 3000 }),
        2025,
      );
      expect(blocked).toBeNull();
      expect(values.gross_ytd).toBe(96000);
    });
  });

  describe("the date it stands for", () => {
    it("is the last day of the W-2's year", () => {
      // A W-2 covers a whole year, so the year-to-date snapshot it
      // describes is the one taken on 31 December.
      const { payDate } = deriveYearEndFigures(w2(REALISTIC), 2025);
      expect(payDate).toBe("2025-12-31");
    });

    it("is withheld when the year is unknown", () => {
      // Filing a whole year of figures against a guessed year would put
      // them in the wrong year's projection.
      const { payDate } = deriveYearEndFigures(w2(REALISTIC), null);
      expect(payDate).toBeNull();
    });
  });
});
