"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { taxApi } from "@/lib/api/tax";
import { W2Upload } from "./w2-upload";
import { deriveYearEndFigures } from "@/lib/tax-docs/w2-to-paystub";
import type { PaystubKey } from "@/lib/tax-docs/paystub-extract";
import { PAYSTUB_LABELS } from "@/lib/tax-docs/paystub-extract";
import { formatCurrency } from "@/lib/format";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Fill a year's figures from its W-2.
 *
 * A paystub row in this app is a snapshot of year-to-date figures at a
 * date, and a W-2 is exactly that snapshot taken on 31 December. So this
 * needs no storage of its own — it fills the same form the paystub
 * reader fills, with the year already complete.
 *
 * It is for the people who never keep a paystub but always have the W-2,
 * and for closing a year out against what actually happened rather than
 * what was projected from a stub in September.
 */
export function W2YearEndUpload({
  onUse,
}: {
  onUse: (
    values: Partial<Record<PaystubKey, number>>,
    payDate: string | null,
  ) => void;
}) {
  // Only years this app has rate tables for. Offering one it cannot
  // compute would let someone file a whole year of figures and find no
  // estimate at the end of it -- the work wasted and nothing to show.
  const { data: years = [] } = useQuery({
    queryKey: ["tax-supported-years"],
    queryFn: taxApi.supportedYears,
    // Rate tables change when the app is deployed, not while it is open.
    staleTime: Infinity,
  });
  const lastYear = new Date().getFullYear() - 1;
  const [chosen, setChosen] = useState<number | null>(null);
  // Last year if the app can do it -- that is the W-2 in your hand --
  // and otherwise the newest year it can.
  const year =
    chosen ??
    (years.includes(lastYear) ? lastYear : (years[years.length - 1] ?? null));
  const setYear = setChosen;

  return (
    <W2Upload
      title="Read a whole year off your W-2"
      actionLabel="Use these figures"
      intro={
        <>
          <p>
            A W-2 is your whole year in one page, so this fills in the year&apos;s
            totals at once — useful if you don&apos;t keep paystubs, or to check a
            finished year against what was estimated for it.
          </p>
          <p className="mt-2">
            It will not change an estimate for a year you already have paystubs
            for unless the W-2 is dated later.
          </p>
        </>
      }
      renderExtras={(extraction) => {
        if (years.length === 0) {
          return (
            <p className="border-t pt-4 text-muted-foreground">
              Checking which years can be worked out…
            </p>
          );
        }
        // The year printed on the form is read, but never used to file
        // by -- a misread year would silently put a whole year of
        // figures in the wrong place. It is used to CHECK the year that
        // was chosen, which is the job it can be trusted with.
        const onForm = extraction.taxYear;
        const cannotCompute = onForm !== null && !years.includes(onForm);
        const mismatched = onForm !== null && year !== null && onForm !== year;
        const derived = deriveYearEndFigures(extraction, year);
        const keys = Object.keys(derived.values) as PaystubKey[];

        return (
          <div className="space-y-3 border-t pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="w2-year">Which year is this W-2 for?</Label>
              <Select
                value={String(year)}
                onValueChange={(v) => setYear(Number(v))}
              >
                <SelectTrigger id="w2-year" className="h-8 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Asked rather than read off the form: these are a whole
                year&apos;s figures, and filing them against the wrong year
                would quietly spoil that year&apos;s estimate.
              </p>
              {!years.includes(lastYear) && (
                <p className="text-xs text-muted-foreground">
                  Only the years listed can be worked out — tax rates are
                  added one year at a time, so {lastYear} is not available
                  yet.
                </p>
              )}
            </div>

            {cannotCompute ? (
              // The honest end of the road: there is nothing useful to
              // do with a year the app cannot work out, and filing it as
              // a different year would be worse than doing nothing.
              <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
                This looks like a {onForm} W-2, and tax rates for {onForm} are
                not in the app — they are added a year at a time. Filing these
                figures under a different year would put a whole year in the
                wrong place, so there is nothing to do with it here yet.
              </p>
            ) : derived.blocked ? (
              <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
                {derived.blocked}
              </p>
            ) : (
              <>
                <div>
                  <p className="font-medium">
                    What this fills in for {year}
                  </p>
                  <table className="mt-1 w-full">
                    <tbody>
                      {keys.map((key) => (
                        <tr key={key} className="border-b last:border-0">
                          <td className="py-1 pr-2">{PAYSTUB_LABELS[key]}</td>
                          <td className="py-1 text-right font-mono">
                            {formatCurrency(derived.values[key]!)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {mismatched && (
                  <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
                    This looks like a {onForm} W-2, but it is set to be filed
                    under {year}. Check the year above before using it.
                  </p>
                )}
                {derived.notes.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {derived.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        );
      }}
      actionBlocked={(extraction) => {
        if (years.length === 0) return "Still checking which years can be worked out";
        const onForm = extraction.taxYear;
        if (onForm !== null && !years.includes(onForm)) {
          return `Tax rates for ${onForm} are not in this app yet`;
        }
        if (year === null) return "Pick a year first";
        return deriveYearEndFigures(extraction, year).blocked;
      }}
      onUse={(extraction) => {
        if (year === null) return;
        // Refused rather than warned about: a year the app has no rates
        // for produces no estimate, so filing it achieves nothing and
        // leaves a year's figures under the wrong heading.
        if (extraction.taxYear !== null && !years.includes(extraction.taxYear)) return;
        const derived = deriveYearEndFigures(extraction, year);
        if (derived.blocked) return;
        onUse(derived.values, derived.payDate);
      }}
    />
  );
}
