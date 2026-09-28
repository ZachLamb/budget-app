"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { usePriorYearExtract } from "@/hooks/use-prior-year-extract";
import { DocumentPicker, WhereItRuns } from "./document-picker";
import {
  FIELD_LABELS,
  FORM_LINES,
  PRIOR_YEAR_FORM_KEYS,
  type PriorYearExtraction,
  type PriorYearKey,
} from "@/lib/tax-docs/prior-year-extract";

/**
 * Read last year's figures off the return instead of typing them.
 *
 * Everything found is shown next to the line of the document it came
 * from, because the only way to trust a machine-read figure is to be
 * able to check it in one glance. Nothing is saved from here -- the
 * figures go into the form below, which the user still submits.
 */
export function PriorYearUpload({
  onUse,
}: {
  onUse: (values: Partial<Record<PriorYearKey, number>>, year: number | null) => void;
}) {
  const { extract, cancel, stage, error, clearError, usesLocalServer, lastSource } = usePriorYearExtract();
  const [result, setResult] = useState<PriorYearExtraction | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    clearError();
    setResult(null);
    setFileName(file.name);
    const extracted = await extract(file);
    if (extracted) setResult(extracted);
  };

  // Only the figures this form stores. The reader also takes line 16 for
  // the back-test, and showing it here would offer a figure with nowhere
  // to go.
  const found = result ? PRIOR_YEAR_FORM_KEYS.filter((k) => result.fields[k]) : [];
  const notFound = result ? PRIOR_YEAR_FORM_KEYS.filter((k) => !result.fields[k]) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Read it off last year&apos;s return</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Pick the PDF of last year&apos;s Form 1040 and the four figures below
          get filled in for you to check.
        </p>
        <WhereItRuns usesLocalServer={usesLocalServer} />

        <DocumentPicker
          label="Choose a PDF"
          ariaLabel="Last year's tax return PDF"
          stage={stage}
          error={error}
          fileName={fileName}
          onFile={(f) => void handleFile(f)}
          onCancel={cancel}
        />

        {result && (
          <div className="space-y-3">
            {lastSource === "image" && (
              <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
                <strong>Read from a photo.</strong> Optical recognition turns a
                3 into an 8 now and then, and a misread digit looks exactly
                like a real figure. Check every one against the paper before
                saving.
              </p>
            )}
            {found.length === 0 ? (
              <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
                <strong>Nothing could be read from that file.</strong> If it is
                a Form 1040, the four figures are on page 1 — type them in
                below and it takes a minute.
              </p>
            ) : (
              <>
                <p>
                  Found {found.length} of {PRIOR_YEAR_FORM_KEYS.length} figures
                  {result.year !== null && <> on a {result.year} return</>}.
                  Check each one against your copy before saving.
                </p>
                <table className="w-full">
                  <tbody>
                    {found.map((key) => (
                      <tr key={key} className="border-b align-top">
                        <td className="py-2 pr-2">
                          {FIELD_LABELS[key]}
                          <span className="block text-xs text-muted-foreground">
                            {FORM_LINES[key]}
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono">
                          {formatCurrency(result.fields[key]!.value)}
                          {/* The quoted line is the receipt: if it does not
                              match the paper, the figure is wrong. */}
                          <span className="mt-0.5 block max-w-full truncate text-xs font-normal text-muted-foreground">
                            read from “{result.fields[key]!.sourceText}”
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {notFound.length > 0 && (
              <div className="text-muted-foreground">
                <p>
                  Left blank, because it was not found or could not be
                  confirmed:{" "}
                  {notFound.map((k) => FIELD_LABELS[k].toLowerCase()).join(", ")}.
                  Nothing was guessed — fill these in yourself if you have them.
                </p>
                {result.rejections.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {result.rejections.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {found.length > 0 && (
              <Button
                type="button"
                onClick={() => {
                  const values: Partial<Record<PriorYearKey, number>> = {};
                  for (const key of found) values[key] = result.fields[key]!.value;
                  onUse(values, result.year);
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
