"use client";

import { useCallback, useState } from "react";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLlm } from "@/lib/llm/useLlm";
import { MaybeAiErrorWithSettings } from "@/components/llm/ai-error-with-settings";
import { userMessageFor } from "@/lib/llm/errors";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setError(null);
    setOutput("");
    setLoading(true);
    try {
      const prepared = await gate.prepareFeature(FEATURE);
      if (!prepared.ok) {
        if (prepared.reason !== "cancelled" && prepared.message) {
          setError(prepared.message);
        }
        return;
      }
      const prompt = buildPrompt(txn);
      for await (const chunk of llm.run(FEATURE, prompt, {
        system: SYSTEM_PROMPT,
        maxTokens: 200,
      })) {
        setOutput((prev) => prev + chunk);
      }
    } catch (e) {
      setError(userMessageFor(e));
    } finally {
      setLoading(false);
    }
  }, [gate, llm, txn]);

  return (
    <div className="space-y-2">
      <Button onClick={() => void run()} disabled={loading} size="sm" variant="outline">
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" />
        )}
        Explain this charge
      </Button>
      {output && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">
          {output}
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <MaybeAiErrorWithSettings message={error} />
        </div>
      )}
    </div>
  );
}
