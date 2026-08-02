"use client";

import { useRef, useState } from "react";
import { Download, Upload, Cpu, Loader2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { aiBundleApi, type ImportReport } from "@/lib/api/ai-bundle";
import { buildJobBundle, type ExportBundle, type SettledSuggestion } from "@/lib/ai-jobs/build";
import { ingestResults, toSuggestionsBundle } from "@/lib/ai-jobs/ingest";
import { isJobResultBundle, type AiJobBundle } from "@/lib/ai-jobs/types";
import { toastApiError, toastPlainError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";

function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Hand the heavy lifting to a local model.
 *
 * Export the *calls* (not just the data), run them against LM Studio with the
 * bundled script, then upload the results. Nothing leaves the machine at any
 * step. Transactions whose payee you've categorized consistently are settled
 * in-browser and never enter the batch.
 */
export function LocalAiHandoffCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  // Kept so the uploaded results can be validated against the batch they came
  // from; re-exporting would produce different ids.
  const [session, setSession] = useState<{
    exported: ExportBundle;
    bundle: AiJobBundle;
    settled: SettledSuggestion[];
  } | null>(null);
  const [pending, setPending] = useState<ReturnType<typeof toSuggestionsBundle> | null>(
    null,
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const exported = await aiBundleApi.export({ scope: "working_set", months: 3 });
      const { settled, bundle } = buildJobBundle(exported);

      if (bundle.jobs.length === 0 && settled.length === 0) {
        appToast.info("Nothing to categorize right now.");
        return;
      }

      setSession({ exported, bundle, settled });
      downloadJson("snacksbudget-jobs.json", bundle);
      appToast.success(
        `Exported ${bundle.jobs.length} job(s).` +
          (settled.length ? ` ${settled.length} settled from your history.` : ""),
      );
    } catch (e) {
      toastApiError("Could not build the export", e);
    } finally {
      setExporting(false);
    }
  };

  const handleFile = async (file: File) => {
    if (!session) {
      toastPlainError("Export a batch first — results are matched against it.");
      return;
    }
    setImporting(true);
    setPreview(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isJobResultBundle(parsed)) {
        toastPlainError("That doesn't look like a results file from the runner.");
        return;
      }

      const report = ingestResults(
        session.exported,
        session.bundle,
        parsed,
        session.settled,
      );
      report.warnings.forEach((w) => appToast.info(w));

      if (report.suggestions.length === 0) {
        toastPlainError("No usable suggestions in that file.");
        return;
      }

      const suggestions = toSuggestionsBundle(report.suggestions);
      setPending(suggestions);
      setPreview(await aiBundleApi.preview(suggestions));
    } catch (e) {
      toastApiError("Could not read that results file", e);
    } finally {
      setImporting(false);
    }
  };

  const handleApply = async () => {
    if (!pending) return;
    setImporting(true);
    try {
      const report = await aiBundleApi.apply(pending);
      appToast.success(`Applied ${report.applied.categorizations} categorization(s).`);
      setPreview(null);
      setPending(null);
      setSession(null);
    } catch (e) {
      toastApiError("Could not apply those suggestions", e);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          Local AI handoff
        </CardTitle>
        <CardDescription>
          Export the AI work as a job file, run it against your own model, then
          import the results. Your data never leaves this machine.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <ol className="space-y-3 text-sm">
          <li className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              1
            </Badge>
            <span className="text-muted-foreground">Export the jobs</span>
            <Button size="sm" onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <Download className="mr-2 h-3 w-3" />
              )}
              Export jobs
            </Button>
          </li>

          <li className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                2
              </Badge>
              <span className="text-muted-foreground">Run them against LM Studio</span>
            </div>
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
              node scripts/run-ai-jobs.mjs snacksbudget-jobs.json results.json
            </pre>
          </li>

          <li className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              3
            </Badge>
            <span className="text-muted-foreground">Import the results</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Results file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={importing || !session}
            >
              {importing ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <Upload className="mr-2 h-3 w-3" />
              )}
              Import results
            </Button>
          </li>
        </ol>

        {session && !preview && (
          <p className="text-xs text-muted-foreground">
            {session.bundle.jobs.length} job(s) exported
            {session.settled.length > 0 &&
              `, ${session.settled.length} already settled from your history`}
            .
          </p>
        )}

        {preview && (
          <div className="space-y-2 rounded border p-3">
            <Label className="text-sm">Preview — nothing has changed yet</Label>
            <p className="text-sm">
              {preview.applied.categorizations} categorization(s) would be applied.
            </p>
            {preview.skipped.categorizations > 0 && (
              <p className="text-xs text-muted-foreground">
                {preview.skipped.categorizations} skipped (unknown or not yours).
              </p>
            )}
            {preview.warnings.map((w) => (
              <p key={w} className="text-xs text-muted-foreground">
                {w}
              </p>
            ))}
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleApply} disabled={importing}>
                Apply
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPreview(null);
                  setPending(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
