import { describe, it, expect } from "vitest";
import {
  applyPaystubCrossChecks,
  payrollTaxDoubts,
  readPayDate,
  verifyPaystub,
} from "./paystub-extract";

const TODAY = new Date(2026, 8, 26);

/** The two-column layout a stub actually prints, flattened by pdf.js. */
const STUB =
  "ACME PAYROLL Pay date 09/15/2026 Period 09/01 - 09/15 " +
  "Earnings Current YTD Gross pay 6,884.62 124,000.00 " +
  "Taxes Current YTD Federal income tax 1,204.81 21,686.58 " +
  "State income tax 302.92 5,452.56 Social Security 426.85 7,688.00 " +
  "Medicare 99.83 1,798.00 " +
  "Pre-tax deductions Current YTD 401(k) 550.77 9,920.00 HSA 150.00 2,700.00";

const f = (value: number, source_text: string) => ({ value, source_text });

const GOOD = {
  pay_date: "2026-09-15",
  gross: f(6884.62, "Gross pay 6,884.62 124,000.00"),
  gross_ytd: f(124000, "Gross pay 6,884.62 124,000.00"),
  federal_withheld: f(1204.81, "Federal income tax 1,204.81 21,686.58"),
  federal_withheld_ytd: f(21686.58, "Federal income tax 1,204.81 21,686.58"),
  state_withheld: f(302.92, "State income tax 302.92 5,452.56"),
  state_withheld_ytd: f(5452.56, "State income tax 302.92 5,452.56"),
  ss_withheld: f(426.85, "Social Security 426.85 7,688.00"),
  ss_withheld_ytd: f(7688, "Social Security 426.85 7,688.00"),
  medicare_withheld: f(99.83, "Medicare 99.83 1,798.00"),
  medicare_withheld_ytd: f(1798, "Medicare 99.83 1,798.00"),
  pretax_401k: f(550.77, "401(k) 550.77 9,920.00"),
  pretax_401k_ytd: f(9920, "401(k) 550.77 9,920.00"),
  pretax_hsa: f(150, "HSA 150.00 2,700.00"),
  pretax_hsa_ytd: f(2700, "HSA 150.00 2,700.00"),
};

const run = (raw: unknown) =>
  applyPaystubCrossChecks(verifyPaystub(raw, STUB, TODAY));

describe("readPayDate", () => {
  it("accepts an ISO date already in the past", () => {
    expect(readPayDate("2026-09-15", TODAY)).toBe("2026-09-15");
  });

  it("refuses a future pay date, which would misdate the projection", () => {
    expect(readPayDate("2027-01-02", TODAY)).toBeNull();
  });

  it("refuses anything that is not a plain ISO date", () => {
    expect(readPayDate("09/15/2026", TODAY)).toBeNull();
    expect(readPayDate("", TODAY)).toBeNull();
    expect(readPayDate(20260915, TODAY)).toBeNull();
    expect(readPayDate("2026-13-45", TODAY)).toBeNull();
  });
});

describe("verifyPaystub", () => {
  it("accepts a correct read of both columns", () => {
    const r = run(GOOD);
    expect(r.missing).toEqual([]);
    expect(r.rejections).toEqual([]);
    expect(r.payDate).toBe("2026-09-15");
    expect(r.fields.gross?.value).toBe(6884.62);
    expect(r.fields.gross_ytd?.value).toBe(124000);
  });

  it("leaves out figures the stub does not carry, rather than zeroing them", () => {
    const r = run({ ...GOOD, pretax_hsa: null, pretax_hsa_ytd: null });
    expect(r.fields.pretax_hsa).toBeUndefined();
    expect(r.missing).toContain("pretax_hsa");
    expect(r.missing).toContain("pretax_hsa_ytd");
    expect(Object.values(r.fields).some((x) => x.value === 0)).toBe(false);
  });
});

describe("the column swap", () => {
  it("drops a pair read the wrong way round", () => {
    // Both numbers are genuinely on the stub — only the columns are swapped.
    const r = run({
      ...GOOD,
      gross: f(124000, "Gross pay 6,884.62 124,000.00"),
      gross_ytd: f(6884.62, "Gross pay 6,884.62 124,000.00"),
    });
    expect(r.fields.gross).toBeUndefined();
    expect(r.fields.gross_ytd).toBeUndefined();
    expect(r.rejections.join(" ")).toContain("wrong way round");
  });

  it("drops the swapped pair without touching the rest of the stub", () => {
    const r = run({
      ...GOOD,
      medicare_withheld: f(1798, "Medicare 99.83 1,798.00"),
      medicare_withheld_ytd: f(99.83, "Medicare 99.83 1,798.00"),
    });
    expect(r.fields.medicare_withheld).toBeUndefined();
    expect(r.fields.gross?.value).toBe(6884.62);
    expect(r.fields.federal_withheld_ytd?.value).toBe(21686.58);
  });

  it("allows a first paycheck of the year, where the two columns match", () => {
    const first =
      "Gross pay 6,884.62 6,884.62 Federal income tax 1,204.81 1,204.81";
    const r = applyPaystubCrossChecks(
      verifyPaystub(
        {
          pay_date: "2026-01-15",
          gross: f(6884.62, "Gross pay 6,884.62 6,884.62"),
          gross_ytd: f(6884.62, "Gross pay 6,884.62 6,884.62"),
        },
        first,
        TODAY,
      ),
    );
    expect(r.fields.gross?.value).toBe(6884.62);
    expect(r.fields.gross_ytd?.value).toBe(6884.62);
  });
});

describe("withholding against gross", () => {
  it("drops a deduction larger than the year's gross pay", () => {
    // Both figures are printed on this stub; the model has read the federal
    // YTD off the gross line, which no per-figure check can see.
    const doc = "Gross pay 500.00 1,000.00 Federal income tax 100.00 5,000.00";
    const r = applyPaystubCrossChecks(
      verifyPaystub(
        {
          pay_date: "2026-09-15",
          gross: f(500, "Gross pay 500.00 1,000.00"),
          gross_ytd: f(1000, "Gross pay 500.00 1,000.00"),
          federal_withheld: f(100, "Federal income tax 100.00 5,000.00"),
          federal_withheld_ytd: f(5000, "Federal income tax 100.00 5,000.00"),
        },
        doc,
        TODAY,
      ),
    );
    expect(r.fields.federal_withheld_ytd).toBeUndefined();
    expect(r.rejections.join(" ")).toContain("larger than gross pay for the year");
    // The figures that are consistent survive.
    expect(r.fields.gross_ytd?.value).toBe(1000);
  });

  it("drops a negative figure", () => {
    const r = run({ ...GOOD, state_withheld: f(-302.92, "State income tax 302.92 5,452.56") });
    expect(r.fields.state_withheld).toBeUndefined();
    expect(r.rejections.join(" ")).toContain("cannot be negative");
  });
});

describe("payrollTaxDoubts", () => {
  it("says nothing when the rates look normal", () => {
    expect(payrollTaxDoubts(run(GOOD))).toEqual([]);
  });

  it("flags a Medicare figure nowhere near 1.45%", () => {
    const r = run({
      ...GOOD,
      medicare_withheld_ytd: f(21686.58, "Federal income tax 1,204.81 21,686.58"),
    });
    const doubts = payrollTaxDoubts(r);
    expect(doubts.join(" ")).toContain("Medicare");
    // A doubt is not a rejection: the figure is on the document, so it stays.
    expect(r.fields.medicare_withheld_ytd?.value).toBe(21686.58);
  });

  it("has nothing to say without gross pay to compare against", () => {
    const r = run({ ...GOOD, gross_ytd: null });
    expect(payrollTaxDoubts(r)).toEqual([]);
  });
});

/**
 * The exact text pdf.js produced from a two-column earnings statement,
 * flattened onto one line the way a real extraction delivers it. Note
 * what sits at the end of it: a NET PAY line carrying two figures in the
 * same shape as the gross line.
 */
const REAL_STUB_TEXT =
  "ACME MANUFACTURING CO Earnings Statement Employee: Local Test User Pay Date: " +
  "09/15/2026 Period: 09/01/2026 - 09/15/2026 EARNINGS RATE HOURS CURRENT YTD " +
  "Regular 86.06 80.00 6,884.62 124,000.00 Gross Pay 6,884.62 124,000.00 TAXES " +
  "CURRENT YTD Federal Income Tax 1,204.81 21,686.58 Social Security 426.85 " +
  "7,688.00 Medicare 99.83 1,798.00 CO State Income Tax 302.92 5,452.56 " +
  "PRE-TAX DEDUCTIONS CURRENT YTD 401(k) Contribution 550.77 9,920.00 " +
  "HSA Employee 150.00 2,700.00 NET PAY 4,349.44 78,755.86";

const realRun = (raw: unknown) =>
  applyPaystubCrossChecks(verifyPaystub(raw, REAL_STUB_TEXT, TODAY));

describe("against text pdf.js actually produced", () => {
  const CORRECT = {
    pay_date: "2026-09-15",
    gross: f(6884.62, "Gross Pay 6,884.62 124,000.00"),
    gross_ytd: f(124000, "Gross Pay 6,884.62 124,000.00"),
    federal_withheld: f(1204.81, "Federal Income Tax 1,204.81 21,686.58"),
    federal_withheld_ytd: f(21686.58, "Federal Income Tax 1,204.81 21,686.58"),
    ss_withheld: f(426.85, "Social Security 426.85 7,688.00"),
    ss_withheld_ytd: f(7688, "Social Security 426.85 7,688.00"),
    medicare_withheld: f(99.83, "Medicare 99.83 1,798.00"),
    medicare_withheld_ytd: f(1798, "Medicare 99.83 1,798.00"),
    state_withheld: f(302.92, "CO State Income Tax 302.92 5,452.56"),
    state_withheld_ytd: f(5452.56, "CO State Income Tax 302.92 5,452.56"),
    pretax_401k: f(550.77, "401(k) Contribution 550.77 9,920.00"),
    pretax_401k_ytd: f(9920, "401(k) Contribution 550.77 9,920.00"),
  };

  it("accepts a correct read of a real stub", () => {
    const r = realRun(CORRECT);
    expect(r.rejections).toEqual([]);
    expect(r.payDate).toBe("2026-09-15");
    expect(r.fields.gross?.value).toBe(6884.62);
    expect(r.fields.gross_ytd?.value).toBe(124000);
    expect(payrollTaxDoubts(r)).toEqual([]);
  });

  it("catches the whole stub read a column out", () => {
    const swapped = Object.fromEntries(
      Object.entries(CORRECT).map(([k, v]) =>
        k === "pay_date" ? [k, v] : [k, v],
      ),
    ) as typeof CORRECT;
    // Swap every pair, as a model that misread the headings would.
    const r = realRun({
      ...swapped,
      gross: CORRECT.gross_ytd,
      gross_ytd: CORRECT.gross,
      federal_withheld: CORRECT.federal_withheld_ytd,
      federal_withheld_ytd: CORRECT.federal_withheld,
      ss_withheld: CORRECT.ss_withheld_ytd,
      ss_withheld_ytd: CORRECT.ss_withheld,
      medicare_withheld: CORRECT.medicare_withheld_ytd,
      medicare_withheld_ytd: CORRECT.medicare_withheld,
      state_withheld: CORRECT.state_withheld_ytd,
      state_withheld_ytd: CORRECT.state_withheld,
      pretax_401k: CORRECT.pretax_401k_ytd,
      pretax_401k_ytd: CORRECT.pretax_401k,
    });
    // Nothing survives, and nothing became a zero.
    expect(r.fields).toEqual({});
    expect(r.rejections.join(" ")).toContain("wrong way round");
  });

  it("does not silently accept net pay read as gross pay", () => {
    // NET PAY is on the stub in exactly the gross line's shape, so the
    // quote checks pass. What gives it away is that the deductions no
    // longer fit inside it.
    const r = realRun({
      ...CORRECT,
      gross: f(4349.44, "NET PAY 4,349.44 78,755.86"),
      gross_ytd: f(78755.86, "NET PAY 4,349.44 78,755.86"),
    });
    expect(payrollTaxDoubts(r).join(" ")).toContain("Social Security");
  });

  it("turns an unreadable stub into blanks, not zeroes", () => {
    const r = realRun({ pay_date: null });
    expect(r.fields).toEqual({});
    expect(r.payDate).toBeNull();
    expect(r.rejections).toEqual([]);
  });
});

/**
 * A real answer from a real model.
 *
 * Captured from google/gemma-4-12b-qat running in LM Studio against the
 * stub above, through the app's own prompt. Fixtures written by hand test
 * what you imagined a model would say; this one tests what one did say —
 * including the trailing ".00" decimals and the shared source lines that
 * hand-written fixtures tend to tidy away.
 */
const REAL_MODEL_OUTPUT = {
    "pay_date": "2026-09-15",
    "gross": {"value": 6884.62, "source_text": "Gross Pay 6,884.62 124,000.00"},
    "gross_ytd": {"value": 124000.00, "source_text": "Gross Pay 6,884.62 124,000.00"},
    "federal_withheld": {"value": 1204.81, "source_text": "Federal Income Tax 1,204.81 21,686.58"},
    "federal_withheld_ytd": {"value": 21686.58, "source_text": "Federal Income Tax 1,204.81 21,686.58"},
    "state_withheld": {"value": 302.92, "source_text": "CO State Income Tax 302.92 5,452.56"},
    "state_withheld_ytd": {"value": 5452.56, "source_text": "CO State Income Tax 302.92 5,452.56"},
    "ss_withheld": {"value": 426.85, "source_text": "Social Security 426.85 7,688.00"},
    "ss_withheld_ytd": {"value": 7688.00, "source_text": "Social Security 426.85 7,688.00"},
    "medicare_withheld": {"value": 99.83, "source_text": "Medicare 99.83 1,798.00"},
    "medicare_withheld_ytd": {"value": 1798.00, "source_text": "Medicare 99.83 1,798.00"},
    "pretax_401k": {"value": 550.77, "source_text": "401(k) Contribution 550.77 9,920.00"},
    "pretax_401k_ytd": {"value": 9920.00, "source_text": "401(k) Contribution 550.77 9,920.00"},
    "pretax_hsa": {"value": 150.00, "source_text": "HSA Employee 150.00 2,700.00"},
    "pretax_hsa_ytd": {"value": 2700.00, "source_text": "HSA Employee 150.00 2,700.00"}
  };

describe("a real model's real output", () => {
  it("passes verification with nothing rejected", () => {
    const r = applyPaystubCrossChecks(
      verifyPaystub(REAL_MODEL_OUTPUT, REAL_STUB_TEXT, TODAY),
    );
    expect(r.rejections).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(Object.keys(r.fields)).toHaveLength(14);
  });

  it("reads the pay date and both columns the right way round", () => {
    const r = applyPaystubCrossChecks(
      verifyPaystub(REAL_MODEL_OUTPUT, REAL_STUB_TEXT, TODAY),
    );
    expect(r.payDate).toBe("2026-09-15");
    expect(r.fields.gross?.value).toBe(6884.62);
    expect(r.fields.gross_ytd?.value).toBe(124000);
    expect(r.fields.medicare_withheld?.value).toBe(99.83);
    expect(r.fields.medicare_withheld_ytd?.value).toBe(1798);
  });

  it("raises no doubts about the payroll tax rates", () => {
    const r = applyPaystubCrossChecks(
      verifyPaystub(REAL_MODEL_OUTPUT, REAL_STUB_TEXT, TODAY),
    );
    expect(payrollTaxDoubts(r)).toEqual([]);
  });
});
