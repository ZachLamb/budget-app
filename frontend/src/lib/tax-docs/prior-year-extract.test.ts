import { describe, it, expect } from "vitest";
import {
  PRIOR_YEAR_KEYS,
  applyCrossChecks,
  verifyExtraction,
} from "./prior-year-extract";

const TODAY = new Date(2026, 8, 23);

const DOC = `
Form 1040 (2025) U.S. Individual Income Tax Return
11  Adjusted gross income .................. 154,692
15  Taxable income ......................... 138,592
24  Total tax .............................. 44,844
25d Federal income tax withheld ............ 48,863
`;

const field = (value: number, source_text: string) => ({ value, source_text });

describe("verifyExtraction", () => {
  it("accepts figures that are quoted from the document", () => {
    const r = verifyExtraction(
      {
        year: 2025,
        agi: field(154692, "11  Adjusted gross income .................. 154,692"),
        taxable_income: field(138592, "15  Taxable income ......................... 138,592"),
        total_tax: field(44844, "24  Total tax .............................. 44,844"),
        total_withheld: field(48863, "25d Federal income tax withheld ............ 48,863"),
      },
      DOC,
      TODAY,
    );
    expect(r.year).toBe(2025);
    // Line 16 is not in this fixture, so it is correctly absent.
    expect(r.missing).toEqual(["tax_before_credits"]);
    expect(r.rejections).toEqual([]);
    expect(r.fields.total_tax).toEqual({
      value: 44844,
      sourceText: "24  Total tax .............................. 44,844",
    });
  });

  it("reports a field the model left out as missing, never as zero", () => {
    const r = verifyExtraction({ year: 2025, agi: field(154692, "Adjusted gross income 154,692") }, DOC, TODAY);
    expect(r.fields.total_tax).toBeUndefined();
    expect(r.missing).toContain("total_tax");
    // The whole point: nothing anywhere became 0.
    expect(Object.values(r.fields).every((f) => f.value !== 0)).toBe(true);
  });

  it("rejects a figure quoted from a line that is not in the document", () => {
    const r = verifyExtraction(
      { total_tax: field(44844, "24 Total tax 44,844 — as reported on your amended return") },
      DOC,
      TODAY,
    );
    expect(r.fields.total_tax).toBeUndefined();
    expect(r.rejections.join(" ")).toContain("not in this document");
  });

  it("rejects an invented figure attached to a real line", () => {
    const r = verifyExtraction(
      { total_tax: field(51200, "24  Total tax .............................. 44,844") },
      DOC,
      TODAY,
    );
    expect(r.fields.total_tax).toBeUndefined();
    expect(r.rejections.join(" ")).toContain("does not appear in the line");
  });

  it("rejects a figure with no quoted line at all", () => {
    const r = verifyExtraction({ total_tax: field(44844, "   ") }, DOC, TODAY);
    expect(r.fields.total_tax).toBeUndefined();
    expect(r.rejections.join(" ")).toContain("no line from the document");
  });

  it("rejects an absurd figure", () => {
    const r = verifyExtraction(
      { agi: field(5e12, "11  Adjusted gross income .................. 154,692") },
      DOC,
      TODAY,
    );
    expect(r.fields.agi).toBeUndefined();
    expect(r.rejections.join(" ")).toContain("too large");
  });

  it("survives a model returning nonsense instead of an object", () => {
    const r = verifyExtraction("sorry, I could not read that", DOC, TODAY);
    expect(r.fields).toEqual({});
    expect(r.missing).toHaveLength(PRIOR_YEAR_KEYS.length);
  });

  it("ignores a year that cannot be a filed return", () => {
    expect(verifyExtraction({ year: 2031 }, DOC, TODAY).year).toBeNull();
    expect(verifyExtraction({ year: 1984 }, DOC, TODAY).year).toBeNull();
    expect(verifyExtraction({ year: "2025" }, DOC, TODAY).year).toBe(2025);
  });
});

describe("applyCrossChecks", () => {
  const base = verifyExtraction(
    {
      year: 2025,
      agi: field(154692, "11  Adjusted gross income .................. 154,692"),
      taxable_income: field(138592, "15  Taxable income ......................... 138,592"),
      total_tax: field(44844, "24  Total tax .............................. 44,844"),
      total_withheld: field(48863, "25d Federal income tax withheld ............ 48,863"),
    },
    DOC,
    TODAY,
  );

  it("leaves a consistent set of figures alone", () => {
    const r = applyCrossChecks(base);
    expect(r.rejections).toEqual([]);
    expect(Object.keys(r.fields).sort()).toEqual([
      "agi",
      "taxable_income",
      "total_tax",
      "total_withheld",
    ]);
  });

  it("drops taxable income that exceeds AGI", () => {
    const r = applyCrossChecks({
      ...base,
      fields: { ...base.fields, taxable_income: { value: 200000, sourceText: "x" } },
    });
    expect(r.fields.taxable_income).toBeUndefined();
    expect(r.missing).toContain("taxable_income");
    expect(r.rejections.join(" ")).toContain("higher than adjusted gross income");
  });

  it("drops a total tax larger than the year's income", () => {
    const r = applyCrossChecks({
      ...base,
      fields: { ...base.fields, total_tax: { value: 900000, sourceText: "x" } },
    });
    expect(r.fields.total_tax).toBeUndefined();
    expect(r.rejections.join(" ")).toContain("higher than the whole year's income");
  });

  it("drops negative tax and negative withholding", () => {
    const r = applyCrossChecks({
      ...base,
      fields: {
        ...base.fields,
        total_tax: { value: -10, sourceText: "x" },
        total_withheld: { value: -5, sourceText: "x" },
      },
    });
    expect(r.fields.total_tax).toBeUndefined();
    expect(r.fields.total_withheld).toBeUndefined();
  });

  it("allows a negative AGI, which a large loss really can produce", () => {
    const withLoss = verifyExtraction(
      { agi: field(-12000, "11 Adjusted gross income -12,000") },
      "11 Adjusted gross income -12,000",
      TODAY,
    );
    expect(applyCrossChecks(withLoss).fields.agi?.value).toBe(-12000);
  });
});

/**
 * The exact text pdf.js produces from a Form 1040, dot leaders and all,
 * flattened onto one line the way a real extraction delivers it. The
 * fixtures above are tidier than reality; this is reality.
 */
const REAL_PDF_TEXT =
  "Form 1040 (2025) U.S. Individual Income Tax Return Department of the Treasury " +
  "- Internal Revenue Service 1z Total amount from Form(s) W-2, box 1 " +
  ".............. 179,000 9 Total income ..................................... " +
  "179,000 10 Adjustments to income ............................ 24,308 11 " +
  "Adjusted gross income ............................ 154,692 12 Standard " +
  "deduction ............................... 16,100 15 Taxable income " +
  "................................... 138,592 16 Tax " +
  ".............................................. 25,860 24 Total tax " +
  "........................................ 44,844 25d Federal income tax " +
  "withheld from all forms ....... 48,863 34 Amount overpaid " +
  "................................... 4,019";

describe("against text pdf.js actually produced", () => {
  it("accepts a correct read of all four figures", () => {
    const r = applyCrossChecks(
      verifyExtraction(
        {
          year: 2025,
          agi: field(154692, "11 Adjusted gross income ............................ 154,692"),
          taxable_income: field(138592, "15 Taxable income ................................... 138,592"),
          total_tax: field(44844, "24 Total tax ........................................ 44,844"),
          total_withheld: field(48863, "25d Federal income tax withheld from all forms ....... 48,863"),
        },
        REAL_PDF_TEXT,
        TODAY,
      ),
    );
    expect(r.rejections).toEqual([]);
    expect(r.fields.agi?.value).toBe(154692);
    expect(r.fields.total_tax?.value).toBe(44844);
  });

  it("throws away a figure invented against a real line", () => {
    const r = applyCrossChecks(
      verifyExtraction(
        // 42,100 is nowhere in the document; the line it is pinned to is.
        { total_tax: field(42100, "24 Total tax ........................................ 44,844") },
        REAL_PDF_TEXT,
        TODAY,
      ),
    );
    expect(r.fields.total_tax).toBeUndefined();
    expect(r.missing).toContain("total_tax");
  });

  it("throws away a plausible line that is not in the document", () => {
    const r = applyCrossChecks(
      verifyExtraction(
        { agi: field(154692, "11 Adjusted gross income (AGI) ... 154,692") },
        REAL_PDF_TEXT,
        TODAY,
      ),
    );
    expect(r.fields.agi).toBeUndefined();
  });

  it("does not turn an unreadable document into a return of zeroes", () => {
    const r = applyCrossChecks(
      verifyExtraction(
        {
          year: null,
          agi: null,
          taxable_income: null,
          total_tax: null,
          total_withheld: null,
        },
        REAL_PDF_TEXT,
        TODAY,
      ),
    );
    expect(r.fields).toEqual({});
    expect(r.missing).toHaveLength(PRIOR_YEAR_KEYS.length);
    expect(r.rejections).toEqual([]);
  });

  it("surfaces the quoted line, which is the only way a reader catches line 16 read as line 24", () => {
    // Both per-field and cross checks pass here: 25,860 really is printed in
    // the document, and it is below AGI. Only the quote gives it away, so it
    // has to reach the UI intact.
    const r = applyCrossChecks(
      verifyExtraction(
        { total_tax: field(25860, "16 Tax .............................................. 25,860") },
        REAL_PDF_TEXT,
        TODAY,
      ),
    );
    expect(r.fields.total_tax?.value).toBe(25860);
    expect(r.fields.total_tax?.sourceText).toContain("16 Tax");
  });
});

describe("line 16 and line 24 are different figures", () => {
  /** A return with a credit: line 16 is the bracket tax, line 24 is net of it. */
  const WITH_CREDIT =
    "11 Adjusted gross income ............................ 154,692 " +
    "15 Taxable income ................................... 138,592 " +
    "16 Tax .............................................. 25,860 " +
    "20 Nonrefundable credits ............................. 2,000 " +
    "24 Total tax ........................................ 23,860";

  it("keeps both, each quoted from its own line", () => {
    const r = applyCrossChecks(
      verifyExtraction(
        {
          year: 2025,
          taxable_income: field(138592, "15 Taxable income ................................... 138,592"),
          tax_before_credits: field(25860, "16 Tax .............................................. 25,860"),
          total_tax: field(23860, "24 Total tax ........................................ 23,860"),
        },
        WITH_CREDIT,
        TODAY,
      ),
    );
    expect(r.fields.tax_before_credits?.value).toBe(25860);
    expect(r.fields.total_tax?.value).toBe(23860);
    expect(r.rejections).toEqual([]);
  });

  it("does not treat line 24 being lower than line 16 as a misread", () => {
    // Credits legitimately pull total tax below the bracket tax. An ordering
    // check between them would throw away a correct read of a real return.
    const r = applyCrossChecks(
      verifyExtraction(
        {
          tax_before_credits: field(25860, "16 Tax .............................................. 25,860"),
          total_tax: field(23860, "24 Total tax ........................................ 23,860"),
        },
        WITH_CREDIT,
        TODAY,
      ),
    );
    expect(r.missing).not.toContain("tax_before_credits");
    expect(r.missing).not.toContain("total_tax");
  });

  it("does not treat line 24 being higher than line 16 as a misread either", () => {
    // Self-employment tax pushes line 24 above line 16 on the same return.
    const doc =
      "11 Adjusted gross income 154,692 16 Tax 25,860 24 Total tax 31,400";
    const r = applyCrossChecks(
      verifyExtraction(
        {
          agi: field(154692, "11 Adjusted gross income 154,692"),
          tax_before_credits: field(25860, "16 Tax 25,860"),
          total_tax: field(31400, "24 Total tax 31,400"),
        },
        doc,
        TODAY,
      ),
    );
    expect(r.fields.tax_before_credits?.value).toBe(25860);
    expect(r.fields.total_tax?.value).toBe(31400);
  });

  it("still holds line 16 to the income bound", () => {
    const doc = "11 Adjusted gross income 154,692 16 Tax 900,000";
    const r = applyCrossChecks(
      verifyExtraction(
        {
          agi: field(154692, "11 Adjusted gross income 154,692"),
          tax_before_credits: field(900000, "16 Tax 900,000"),
        },
        doc,
        TODAY,
      ),
    );
    expect(r.fields.tax_before_credits).toBeUndefined();
    expect(r.rejections.join(" ")).toContain("higher than the whole year's income");
  });
});


/**
 * A real answer from a real model, on a return where the two tax lines
 * differ. Captured from google/gemma-4-12b-qat through the app's own
 * prompt. The point of the fixture is the pair: line 24 at 44,844 and
 * line 16 at 25,860, each quoted from its own line.
 */
const REAL_MODEL_OUTPUT = {
    "year": 2025,
    "agi": {
      "value": 154692,
      "source_text": "11 Adjusted gross income ............................ 154,692"
    },
    "taxable_income": {
      "value": 138592,
      "source_text": "15 Taxable income ................................... 138,592"
    },
    "total_tax": {
      "value": 44844,
      "source_text": "24 Total tax ........................................ 44,844"
    },
    "total_withheld": {
      "value": 48863,
      "source_text": "25d Federal income tax withheld from all forms ....... 48,863"
    },
    "tax_before_credits": {
      "value": 25860,
      "source_text": "16 Tax .............................................. 25,860"
    }
  };

describe("a real model's real output", () => {
  const r = applyCrossChecks(
    verifyExtraction(REAL_MODEL_OUTPUT, REAL_PDF_TEXT, TODAY),
  );

  it("keeps all five figures with nothing rejected", () => {
    expect(r.rejections).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.year).toBe(2025);
  });

  it("reads line 16 and line 24 as the different figures they are", () => {
    expect(r.fields.total_tax?.value).toBe(44844);
    expect(r.fields.tax_before_credits?.value).toBe(25860);
    expect(r.fields.total_tax?.sourceText).toContain("24 Total tax");
    expect(r.fields.tax_before_credits?.sourceText).toContain("16 Tax");
  });
});
