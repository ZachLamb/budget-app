"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { appToast } from "@/lib/app-toast";
import { toastApiError } from "@/lib/toast-error";
import { backtestApi, type BacktestReturn } from "@/lib/api/tax";
import type { PriorYearKey } from "@/lib/tax-docs/prior-year-extract";
import { W2_KEYS, type W2Key } from "@/lib/tax-docs/w2-extract";
import { PriorYearUpload } from "./prior-year-upload";
import { W2Upload } from "./w2-upload";
import { deriveYearEndFigures } from "@/lib/tax-docs/w2-to-paystub";

/**
 * Fill the back-test's fixture from a real filed return.
 *
 * The gate in `backend/tests/backtest/` has skipped since it was written,
 * because its input file is gitignored and had to be typed by hand. The
 * readers can fill it instead.
 *
 * Development only. The endpoint refuses when a production marker is set,
 * and this card is not rendered in a production build either -- the file
 * describes a real person's filed return.
 */

/**
 * The 1040 reader does not take the checked filing-status box yet, and the
 * engine now computes all five. Guessing "single" would put a wrong status
 * into a fixture whose whole job is catching wrong numbers, so it is asked
 * for instead.
 */
const FILING_STATUSES = [
  ["single", "Single"],
  ["married_joint", "Married filing jointly"],
  ["married_separate", "Married filing separately"],
  ["head_of_household", "Head of household"],
  ["qualifying_surviving_spouse", "Qualifying surviving spouse"],
] as const;

/** Figures the fixture wants that no reader here supplies. */
const HAND_ENTERED = [
  {
    key: "actual_state_tax" as const,
    label: "Colorado net tax",
    note: "From your DR 0104. There is no reader for it yet.",
  },
];

function money(value: number | undefined): string | undefined {
  return value === undefined ? undefined : value.toFixed(2);
}

export function BacktestPanel() {
  const [prior, setPrior] = useState<Partial<Record<PriorYearKey, number>> | null>(null);
  const [priorYear, setPriorYear] = useState<number | null>(null);
  const [w2, setW2] = useState<Partial<Record<W2Key, number>> | null>(null);
  const [grossYtd, setGrossYtd] = useState<number | null>(null);
  const [stateTax, setStateTax] = useState("");
  const [filingStatus, setFilingStatus] = useState<string>("single");
  const [saving, setSaving] = useState(false);

  // Gross wages are not printed on a W-2 and have to be worked out --
  // box 1 alone is already net of the deferrals and understates every
  // figure downstream, which the back-test README calls out as the usual
  // cause of a false failure. Worked out by `deriveYearEndFigures` when
  // the file is read, not here: a second copy of that arithmetic is a
  // second thing to get wrong, and it would make the back-test check the
  // engine against a gross the rest of the app disagrees with.
  const grossWages = grossYtd ?? undefined;

  const record: BacktestReturn | null =
    priorYear === null
      ? null
      : {
          year: priorYear,
          filing_status: filingStatus,
          wages: money(grossWages),
          pretax_401k: money(w2?.pretax_401k),
          pretax_hsa: money(w2?.pretax_hsa),
          federal_withheld: money(w2?.federal_withheld),
          state_withheld: money(w2?.state_withheld),
          ss_withheld: money(w2?.ss_withheld),
          medicare_withheld: money(w2?.medicare_withheld),
          actual_taxable_income: money(prior?.taxable_income),
          actual_federal_income_tax: money(prior?.tax_before_credits),
          actual_state_tax: stateTax.trim() === "" ? undefined : Number(stateTax).toFixed(2),
          actual_ss_tax: money(w2?.ss_withheld),
          actual_medicare_tax: money(w2?.medicare_withheld),
        };

  const compared = record
    ? [
        ["Taxable income", record.actual_taxable_income, "1040 line 15"],
        ["Federal income tax", record.actual_federal_income_tax, "1040 line 16"],
        ["Colorado tax", record.actual_state_tax, "DR 0104"],
        ["Social Security tax", record.actual_ss_tax, "W-2 box 4"],
        ["Medicare tax", record.actual_medicare_tax, "W-2 box 6"],
      ]
    : [];
  const haveAny = compared.some(([, value]) => value !== undefined);

  const save = async () => {
    if (!record) return;
    setSaving(true);
    try {
      await backtestApi.writeFixture([record]);
      appToast.success("Fixture written. Run: cd backend && pytest tests/backtest/ -v");
    } catch (e) {
      toastApiError("Could not write the fixture", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle>Back-test against a filed return (development)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Read last year&apos;s 1040 and W-2 to fill the back-test&apos;s fixture,
          then run the gate. The file it writes is gitignored and stays on this
          machine; nothing about it is uploaded or logged.
        </p>

        <PriorYearUpload
          onUse={(values, year) => {
            setPrior(values);
            setPriorYear(year);
          }}
        />
        <W2Upload
          onUse={(extraction) => {
            const values: Partial<Record<W2Key, number>> = {};
            for (const key of W2_KEYS) {
              const f = extraction.fields[key];
              if (f) values[key] = f.value;
            }
            setW2(values);
            // Gross is not printed on a W-2 and has to be worked out.
            // Taken from the shared derivation rather than repeated
            // here, so the back-test cannot end up checking the engine
            // against a gross the rest of the app would not agree with.
            setGrossYtd(deriveYearEndFigures(extraction, null).values.gross_ytd ?? null);
          }}
        />

        <div>
          <Label htmlFor="backtest-filing-status">Filing status on that return</Label>
          <select
            id="backtest-filing-status"
            className="mt-1 block h-9 max-w-xs rounded-md border bg-background px-2 text-sm"
            value={filingStatus}
            onChange={(e) => setFilingStatus(e.target.value)}
          >
            {FILING_STATUSES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            From the checked box at the top of the 1040. The reader does not
            take it yet, and the wrong one silently changes every figure the
            gate compares.
          </p>
        </div>

        {HAND_ENTERED.map((field) => (
          <div key={field.key}>
            <Label htmlFor={field.key}>{field.label}</Label>
            <Input
              id={field.key}
              className="max-w-xs"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={stateTax}
              onChange={(e) => setStateTax(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">{field.note}</p>
          </div>
        ))}

        <div className="rounded border p-3">
          <p className="font-medium">What the gate will compare</p>
          {priorYear === null ? (
            <p className="mt-1 text-muted-foreground">
              Read a 1040 first — its year decides which rate table the engine
              is checked against.
            </p>
          ) : (
            <table className="mt-2 w-full">
              <tbody>
                {compared.map(([label, value, source]) => (
                  <tr key={label} className="border-b">
                    <td className="py-1">
                      {label}
                      <span className="block text-xs text-muted-foreground">{source}</span>
                    </td>
                    <td className="py-1 text-right font-mono">
                      {value ?? <span className="text-xs text-muted-foreground">not read</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <Button type="button" onClick={save} disabled={!record || !haveAny || saving}>
          {saving ? "Writing…" : "Write the fixture"}
        </Button>
        {record && !haveAny && (
          <p className="text-xs text-muted-foreground">
            Nothing to compare yet. A record with no expected figure would pass
            the gate on nothing, so the endpoint refuses it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
