"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import type { ExtractStage } from "@/hooks/use-tax-doc-extract";

const STAGE_LABELS: Record<Exclude<ExtractStage, null>, string> = {
  preparing: "Getting the on-device model ready — the first time can take a few minutes…",
  reading: "Reading the file…",
  thinking: "Finding the figures…",
};

/**
 * The file button, the stage it is at, and anything that went wrong.
 *
 * Shared by the tax documents this page can read, so they say the same
 * thing about what is happening — and so the stage labels stay honest in
 * one place rather than drifting apart.
 */
export function DocumentPicker({
  label,
  ariaLabel,
  stage,
  error,
  fileName,
  onFile,
  onCancel,
}: {
  label: string;
  ariaLabel: string;
  stage: ExtractStage;
  error: string | null;
  fileName: string | null;
  onFile: (file: File) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          aria-label={ariaLabel}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Let the same file be picked again after a failed read.
            e.target.value = "";
            if (file) onFile(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={stage !== null}
        >
          {stage === null ? label : "Working…"}
        </Button>
        {stage && (
          <>
            <span className="text-muted-foreground">{STAGE_LABELS[stage]}</span>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </>
        )}
        {!stage && fileName && !error && (
          <span className="text-xs text-muted-foreground">{fileName}</span>
        )}
      </div>

      {error && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2">{error}</p>
      )}
    </>
  );
}

/**
 * Where the document is about to be processed.
 *
 * Worth its own component because getting it wrong is a privacy claim, not
 * a wording choice. On-device really does mean the text never leaves the
 * tab. The local-server path reaches LM Studio or Ollama through this
 * app's own backend, so the text does leave the browser -- for a machine
 * the user runs, but it leaves, and the card has to say so.
 */
export function WhereItRuns({ usesLocalServer }: { usesLocalServer: boolean }) {
  return (
    <p className="text-xs text-muted-foreground">
      {usesLocalServer ? (
        <>
          The file is read in your browser, and its text is sent to the model
          server you run — by way of this app&apos;s backend. It does not go to
          anyone else, and the file itself is never uploaded or stored.
        </>
      ) : (
        <>
          The file is read in your browser by a model on this device. Neither
          the file nor its text leaves the machine, and nothing is kept except
          the numbers you save.
        </>
      )}
    </p>
  );
}
