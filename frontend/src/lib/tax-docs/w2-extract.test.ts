import { describe, it, expect } from "vitest";
import { applyW2CrossChecks, verifyW2, w2Doubts } from "./w2-extract";

/** A W-2's boxes as pdf.js flattens them: label, number, value. */
const W2 =
  "2025 Form W-2 Wage and Tax Statement ACME MANUFACTURING CO " +
  "1 Wages, tips, other compensation 154692.00 2 Federal income tax withheld 25860.00 " +
  "3 Social Security wages 164612.00 4 Social Security tax withheld 10205.94 " +
  "5 Medicare wages and tips 164612.00 6 Medicare tax withheld 2386.87 " +
  "12a D 9920.00 12b W 2700.00 " +
  "16 State wages, tips, etc. 154692.00 17 State income tax 6098.06";

const f = (value: number, source_text: string) => ({ value, source_text });

const GOOD = {
  wages: f(154692, "1 Wages, tips, other compensation 154692.00"),
  federal_withheld: f(25860, "2 Federal income tax withheld 25860.00"),
  ss_wages: f(164612, "3 Social Security wages 164612.00"),
  ss_withheld: f(10205.94, "4 Social Security tax withheld 10205.94"),
  medicare_wages: f(164612, "5 Medicare wages and tips 164612.00"),
  medicare_withheld: f(2386.87, "6 Medicare tax withheld 2386.87"),
  pretax_401k: f(9920, "12a D 9920.00"),
  pretax_hsa: f(2700, "12b W 2700.00"),
  state_wages: f(154692, "16 State wages, tips, etc. 154692.00"),
  state_withheld: f(6098.06, "17 State income tax 6098.06"),
};

const run = (raw: unknown) => applyW2CrossChecks(verifyW2(raw, W2));

describe("verifyW2", () => {
  it("accepts a correct read of all ten boxes", () => {
    const r = run(GOOD);
    expect(r.missing).toEqual([]);
    expect(r.rejections).toEqual([]);
    expect(r.fields.wages?.value).toBe(154692);
    expect(r.fields.pretax_401k?.value).toBe(9920);
  });

  it("raises no doubts on a consistent W-2", () => {
    expect(w2Doubts(run(GOOD))).toEqual([]);
  });

  it("leaves a box the form does not carry blank, never zero", () => {
    const r = run({ ...GOOD, pretax_hsa: null, state_withheld: null });
    expect(r.fields.pretax_hsa).toBeUndefined();
    expect(r.missing).toContain("pretax_hsa");
    expect(Object.values(r.fields).some((x) => x.value === 0)).toBe(false);
  });
});

describe("a tax box cannot exceed the wages it came from", () => {
  it("drops federal withholding larger than box 1", () => {
    const doc = "1 Wages 1000.00 2 Federal income tax withheld 5000.00";
    const r = applyW2CrossChecks(
      verifyW2(
        {
          wages: f(1000, "1 Wages 1000.00"),
          federal_withheld: f(5000, "2 Federal income tax withheld 5000.00"),
        },
        doc,
      ),
    );
    expect(r.fields.federal_withheld).toBeUndefined();
    expect(r.rejections.join(" ")).toContain("larger than wages");
  });

  it("drops Social Security tax larger than box 3", () => {
    const doc = "3 Social Security wages 1000.00 4 Social Security tax withheld 9000.00";
    const r = applyW2CrossChecks(
      verifyW2(
        {
          ss_wages: f(1000, "3 Social Security wages 1000.00"),
          ss_withheld: f(9000, "4 Social Security tax withheld 9000.00"),
        },
        doc,
      ),
    );
    expect(r.fields.ss_withheld).toBeUndefined();
  });
});

describe("boxes 3 and 5 read the wrong way round", () => {
  it("drops the pair when Medicare wages come out below Social Security wages", () => {
    // Both figures are on the document; only the boxes are swapped. Social
    // Security is capped and Medicare is not, so this ordering is impossible.
    const r = run({
      ...GOOD,
      ss_wages: f(164612, "3 Social Security wages 164612.00"),
      medicare_wages: f(154692, "1 Wages, tips, other compensation 154692.00"),
    });
    expect(r.fields.ss_wages).toBeUndefined();
    expect(r.fields.medicare_wages).toBeUndefined();
    expect(r.rejections.join(" ")).toContain("wrong way round");
  });

  it("allows them to be equal, which is the ordinary case under the cap", () => {
    const r = run(GOOD);
    expect(r.fields.ss_wages?.value).toBe(164612);
    expect(r.fields.medicare_wages?.value).toBe(164612);
  });
});

describe("w2Doubts", () => {
  it("flags a Social Security figure nowhere near 6.2%", () => {
    const r = run({ ...GOOD, ss_withheld: f(2386.87, "6 Medicare tax withheld 2386.87") });
    expect(w2Doubts(r).join(" ")).toContain("Box 4");
    // A doubt is not a rejection: the figure is on the document, so it stays.
    expect(r.fields.ss_withheld?.value).toBe(2386.87);
  });

  it("does not flag Medicare ABOVE the rate, which the additional tax explains", () => {
    const doc = "5 Medicare wages and tips 300000.00 6 Medicare tax withheld 5250.00";
    const r = applyW2CrossChecks(
      verifyW2(
        {
          medicare_wages: f(300000, "5 Medicare wages and tips 300000.00"),
          medicare_withheld: f(5250, "6 Medicare tax withheld 5250.00"),
        },
        doc,
      ),
    );
    // 1.75% of wages — above 1.45%, because of the 0.9% additional tax.
    expect(w2Doubts(r)).toEqual([]);
  });

  it("notices when box 1 plus the deferral does not reach box 5", () => {
    const r = run({ ...GOOD, pretax_401k: f(2700, "12b W 2700.00") });
    expect(w2Doubts(r).join(" ")).toContain("does not come close to box 5");
  });

  it("has nothing to say without the boxes to compare", () => {
    expect(w2Doubts(run({ wages: GOOD.wages }))).toEqual([]);
  });
});


/**
 * A real answer from a real model.
 *
 * Captured from google/gemma-4-12b-qat through the app's own prompt, on a
 * W-2 whose box 12 carries three entries: D, W and DD. Code DD is
 * employer-paid health coverage, not a deferral, and taking it as the
 * 401(k) would overstate gross wages by $14,200 in the back-test fixture.
 */
const REAL_MODEL_OUTPUT = {
    "wages": {
      "value": 154692.0,
      "source_text": "Wages, tips, other compensation ....... 154692.00"
    },
    "federal_withheld": {
      "value": 25860.0,
      "source_text": "Federal income tax withheld ........... 25860.00"
    },
    "ss_wages": {
      "value": 164612.0,
      "source_text": "Social Security wages ................. 164612.00"
    },
    "ss_withheld": {
      "value": 10205.94,
      "source_text": "Social Security tax withheld .......... 10205.94"
    },
    "medicare_wages": {
      "value": 164612.0,
      "source_text": "Medicare wages and tips ............... 164612.00"
    },
    "medicare_withheld": {
      "value": 2386.87,
      "source_text": "Medicare tax withheld ................. 2386.87"
    },
    "pretax_401k": {
      "value": 9920.0,
      "source_text": "12a D 9920.00"
    },
    "pretax_hsa": {
      "value": 2700.0,
      "source_text": "12b W 2700.00"
    },
    "state_wages": {
      "value": 154692.0,
      "source_text": "State wages ............ 154692.00"
    },
    "state_withheld": {
      "value": 6098.06,
      "source_text": "State income tax .................... 6098.06"
    }
  };

/** The document that answer was read from, as pdf.js flattened it. */
const REAL_W2_TEXT =
  "2025 Form W-2 Wage and Tax Statement Employer: ACME MANUFACTURING CO " +
  "Employee: Local Test User 1 Wages, tips, other compensation ....... 154692.00 " +
  "2 Federal income tax withheld ........... 25860.00 3 Social Security wages " +
  "................. 164612.00 4 Social Security tax withheld .......... 10205.94 " +
  "5 Medicare wages and tips ............... 164612.00 6 Medicare tax withheld " +
  "................. 2386.87 12a D 9920.00 12b W 2700.00 12c DD 14200.00 " +
  "15 State CO 16 State wages ............ 154692.00 17 State income tax " +
  ".................... 6098.06";

describe("a real model's real output", () => {
  const r = applyW2CrossChecks(verifyW2(REAL_MODEL_OUTPUT, REAL_W2_TEXT));

  it("keeps all ten boxes with nothing rejected", () => {
    expect(r.rejections).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("takes code D for the 401(k), not the DD beside it", () => {
    expect(r.fields.pretax_401k?.value).toBe(9920);
    expect(r.fields.pretax_401k?.sourceText).toContain("D 9920.00");
    expect(r.fields.pretax_401k?.value).not.toBe(14200);
  });

  it("raises no doubts, and the box arithmetic holds", () => {
    expect(w2Doubts(r)).toEqual([]);
    // Box 1 is net of both deferrals; boxes 3 and 5 are not.
    const gross = r.fields.wages!.value + r.fields.pretax_401k!.value + r.fields.pretax_hsa!.value;
    expect(gross).toBeCloseTo(167312, 2);
  });
});

describe("the year on the form", () => {
  const doc = "1 Wages, tips, other compensation 85000.00";

  it("is read when it is a plausible W-2 year", () => {
    const out = verifyW2({ tax_year: 2025 }, doc, new Date("2026-03-01"));
    expect(out.taxYear).toBe(2025);
  });

  it("is null when it was not read", () => {
    expect(verifyW2({}, doc, new Date("2026-03-01")).taxYear).toBeNull();
  });

  it("refuses a year that has not happened", () => {
    // A W-2 exists for a year that has started. Anything later is a
    // misread, and acting on it would file figures into the future.
    expect(verifyW2({ tax_year: 2030 }, doc, new Date("2026-03-01")).taxYear).toBeNull();
  });

  it("refuses an implausibly old year", () => {
    expect(verifyW2({ tax_year: 1995 }, doc, new Date("2026-03-01")).taxYear).toBeNull();
  });

  it("refuses something that is not a whole number", () => {
    expect(verifyW2({ tax_year: "twenty-25" }, doc, new Date("2026-03-01")).taxYear).toBeNull();
    expect(verifyW2({ tax_year: 2025.5 }, doc, new Date("2026-03-01")).taxYear).toBeNull();
  });

  it("survives the cross-checks that drop boxes", () => {
    // `dropField` rebuilds the verified fields, so the year has to be
    // carried across deliberately or it vanishes whenever a box is
    // dropped.
    const out = applyW2CrossChecks(
      verifyW2(
        {
          tax_year: 2025,
          // Withholding above its wage box: gets dropped.
          federal_withheld: { value: 99999, source_text: "2 Federal income tax withheld 99999" },
          wages: { value: 100, source_text: "1 Wages, tips, other compensation 100" },
        },
        "2 Federal income tax withheld 99999\n1 Wages, tips, other compensation 100",
        new Date("2026-03-01"),
      ),
    );
    expect(out.taxYear).toBe(2025);
    expect(out.fields.federal_withheld).toBeUndefined();
  });
});
