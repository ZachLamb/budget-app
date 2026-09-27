"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import { usePaystubExtract } from "@/hooks/use-paystub-extract";
import {
  PAYSTUB_PAIRS,
  payrollTaxDoubts,
  type PaystubExtraction,
  type PaystubKey,
} from "@/lib/tax-docs/paystub-extract";
import { DocumentPicker, WhereItRuns } from "./document-picker";

/**
 * Read a paystub instead of typing fourteen boxes off it.
 *
 * Figures are shown in the two columns the stub prints them in, next to
 * the line each was read from, because the mistake worth catching here
 * is a pair read the wrong way round — and the quoted line is what makes
 * that visible at a glance.
 */
export function PaystubUpload({
  onUse,
}: {
  onUse: (values: Partial<Record<PaystubKey, number>>, payDate: string | null) => void;
}) {
  const { extract, cancel, stage, error, clearError, usesLocalServer } = usePaystubExtract();
  const [result, setResult] = useState<PaystubExtraction | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    clearError();
    setResult(null);
    setFileName(file.name);
    const extracted = await extract(file);
    if (extracted) setResult(extracted);
  };

  const rows = result
    ? PAYSTUB_PAIRS.filter((p) => result.fields[p.now] || result.fields[p.ytd])
    : [];
  const doubts = result ? payrollTaxDoubts(result) : [];
  const foundCount = result ? Object.keys(result.fields).length : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Read it off your paystub</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Pick the PDF your employer sent and the figures below get filled in
          for you to check.
        </p>
        <WhereItRuns usesLocalServer={usesLocalServer} />

        <DocumentPicker
          label="Choose a PDF"
          ariaLabel="Paystub PDF"
          stage={stage}
          error={error}
          fileName={fileName}
          onFile={(f) => void handleFile(f)}
          onCancel={cancel}
        />

        {result && (
          <div className="space-y-3">
            {foundCount === 0 ? (
              <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
                <strong>Nothing could be read from that file.</strong> Fill the
                form in below instead — only the pay date, gross pay and gross
                year-to-date are needed to get an estimate.
              </p>
            ) : (
              <>
                <p>
                  Found {foundCount} figure{foundCount === 1 ? "" : "s"}
                  {result.payDate && <> on a stub dated {formatDate(result.payDate)}</>}
                  . Check them against your stub before saving.
                </p>
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-1 text-left font-normal">Figure</th>
                      <th className="py-1 text-right font-normal">This check</th>
                      <th className="py-1 text-right font-normal">Year to date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((pair) => (
                      <tr key={pair.now} className="border-b align-top">
                        <td className="py-2 pr-2">
                          {pair.label}
                          {/* One line usually carries both columns, so quote
                              it once under the row it explains. */}
                          <span className="block truncate text-xs text-muted-foreground">
                            read from “
                            {result.fields[pair.now]?.sourceText ??
                              result.fields[pair.ytd]?.sourceText}
                            ”
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono">
                          {result.fields[pair.now]
                            ? formatCurrency(result.fields[pair.now]!.value)
                            : "—"}
                        </td>
                        <td className="py-2 text-right font-mono">
                          {result.fields[pair.ytd]
                            ? formatCurrency(result.fields[pair.ytd]!.value)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {doubts.length > 0 && (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
                <p className="font-medium">Worth checking twice</p>
                <ul className="mt-1 list-disc pl-5">
                  {doubts.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.rejections.length > 0 && (
              <div className="text-muted-foreground">
                <p>
                  Left blank, because it could not be confirmed. Nothing was
                  guessed — fill these in yourself from the stub.
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {result.rejections.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {foundCount > 0 && (
              <Button
                type="button"
                onClick={() => {
                  const values: Partial<Record<PaystubKey, number>> = {};
                  for (const key of Object.keys(result.fields) as PaystubKey[]) {
                    values[key] = result.fields[key]!.value;
                  }
                  onUse(values, result.payDate);
                }}
              >
                Put these in the form
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
