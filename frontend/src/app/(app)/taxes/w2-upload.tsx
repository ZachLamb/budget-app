"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { useW2Extract } from "@/hooks/use-w2-extract";
import {
  W2_BOXES,
  W2_KEYS,
  W2_LABELS,
  w2Doubts,
  type W2Extraction,
  type W2Key,
} from "@/lib/tax-docs/w2-extract";
import { DocumentPicker, WhereItRuns } from "./document-picker";

/**
 * Read a W-2's numbered boxes.
 *
 * Each figure is shown beside its box number and the line it was read
 * from, because "box 4, read from '4 Social Security tax withheld
 * 10205.94'" can be checked against the paper in one glance, and "10205.94"
 * cannot.
 */
export function W2Upload({
  onUse,
}: {
  onUse: (values: Partial<Record<W2Key, number>>) => void;
}) {
  const { extract, cancel, stage, error, clearError, usesLocalServer, lastSource } = useW2Extract();
  const [result, setResult] = useState<W2Extraction | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    clearError();
    setResult(null);
    setFileName(file.name);
    const extracted = await extract(file);
    if (extracted) setResult(extracted);
  };

  const found = result ? W2_KEYS.filter((k) => result.fields[k]) : [];
  const doubts = result ? w2Doubts(result) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Read it off your W-2</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Pick the W-2 your employer sent. Its numbered boxes are what the tax
          estimate is checked against.
        </p>

        <WhereItRuns usesLocalServer={usesLocalServer} />

        <DocumentPicker
          label="Choose a PDF"
          ariaLabel="W-2 PDF"
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
                a W-2, the boxes are numbered 1 to 17 on the form itself.
              </p>
            ) : (
              <>
                <p>
                  Found {found.length} of {W2_KEYS.length} boxes. Check them
                  against your copy before saving.
                </p>
                <table className="w-full">
                  <tbody>
                    {found.map((key) => (
                      <tr key={key} className="border-b align-top">
                        <td className="py-2 pr-2">
                          {W2_LABELS[key]}
                          <span className="block text-xs text-muted-foreground">
                            {W2_BOXES[key]}
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono">
                          {formatCurrency(result.fields[key]!.value)}
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
                  guessed — read these off the form yourself.
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {result.rejections.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {found.length > 0 && (
              <Button
                type="button"
                onClick={() => {
                  const values: Partial<Record<W2Key, number>> = {};
                  for (const key of found) values[key] = result.fields[key]!.value;
                  onUse(values);
                }}
              >
                Use these figures
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
