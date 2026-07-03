"use client";

import { useCallback, useRef, useState } from "react";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLlm } from "@/lib/llm/useLlm";
import { AiErrorWithSettings } from "@/components/llm/ai-error-with-settings";
import { AiRunStatus } from "@/components/llm/ai-run-status";
import { userMessageFor } from "@/lib/llm/errors";
import { interpretPrepareFeatureResult } from "@/lib/llm/prepare-feature-result";
import type { Transaction } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";

interface Props {
  txn: Transaction;
}

const FEATURE = "explain_charge" as const;

const SYSTEM_PROMPT =
  "You explain a single transaction to a user in 1-2 short sentences. Plain language, no markdown. No financial advice. Use the data given; don't invent details.";

function buildPrompt(t: Transaction): string {
  return [
    `Date: ${new Date(t.date).toLocaleDateString()}`,
    `Payee: ${t.payee_name || "Unknown"}`,
    `Amount: ${formatCurrency(Number(t.amount))}`,
    `Category: ${t.category_name || "Uncategorized"}`,
    t.notes ? `Notes: ${t.notes}` : null,
    "",
    "Explain this charge to the user in 1-2 short sentences.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function ExplainCharge({ txn }: Props) {
  const llm = useLlm();
  const gate = useAiFeatureGate();
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorShowsSettings, setErrorShowsSettings] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);

  const run = useCallback(async () => {
    setError(null);
    setErrorShowsSettings(false);
    setOutput("");

    const prepared = await gate.prepareFeature(FEATURE);
    const interpretation = interpretPrepareFeatureResult(prepared);
    if (interpretation.action === "stop") {
      setError(interpretation.userMessage);
      setErrorShowsSettings(interpretation.showSettingsLink);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);

    try {
      const prompt = buildPrompt(txn);
      for await (const chunk of llm.run(FEATURE, prompt, {
        system: SYSTEM_PROMPT,
        maxTokens: 200,
        signal: ac.signal,
      })) {
        setOutput((prev) => prev + chunk);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(userMessageFor(e));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [gate, llm, txn]);

  return (
    <div className="space-y-2">
      <Button
        onClick={() => void run()}
        disabled={running}
        size="sm"
        variant="outline"
        aria-busy={running}
      >
        {running ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" />
        )}
        Explain this charge
      </Button>
      {running ? (
        <AiRunStatus
          progress={{ step: "explain", label: "Explaining…" }}
          onCancel={cancel}
        />
      ) : null}
      {output ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">
          {output}
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          {errorShowsSettings ? (
            <AiErrorWithSettings message={error} />
          ) : (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
