"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiRunStatus } from "@/components/llm/ai-run-status";
import { MaybeAiErrorWithSettings } from "@/components/llm/ai-error-with-settings";
import { useAiPipelineRun } from "@/hooks/use-ai-pipeline-run";
import type { AnomalyFact } from "@/lib/api/ai";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Per-transaction "explain why flagged" for an anomalous expense.
 *
 * The deterministic numbers (amount, ratio, category average) are rendered
 * directly from the grounded fact so the user always sees the real figures;
 * the model only streams the explanatory prose, which is treated as untrusted
 * text.
 */
export function AnomalyExplain({ fact }: { fact: AnomalyFact }) {
  const ai = useAiPipelineRun("anomaly_explanation");
  const [text, setText] = useState("");

  const explain = async () => {
    setText("");
    ai.clearError();
    try {
      await ai.runStream(
        `Explain in one sentence why this expense is unusual. Use only these facts; do not invent numbers.\n` +
          `Facts: ${JSON.stringify(fact)}`,
        (chunk) => setText((s) => s + chunk),
        { maxTokens: 120 },
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  };

  return (
    <div className="mt-1 space-y-1">
      <p className="text-xs text-muted-foreground">
        {formatCurrency(fact.amount)} · about {fact.ratio.toFixed(1)}× your usual {fact.category}{" "}
        (avg {formatCurrency(fact.category_avg)})
      </p>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-xs"
        onClick={() => void explain()}
        disabled={ai.running}
        aria-busy={ai.running}
      >
        <Sparkles className={cn("mr-1 h-3 w-3", ai.running && "animate-pulse")} aria-hidden />
        Explain why flagged
      </Button>
      {ai.running ? <AiRunStatus progress={ai.progress} onCancel={ai.cancel} /> : null}
      {ai.error ? <MaybeAiErrorWithSettings message={ai.error} /> : null}
      {text ? <p className="text-xs text-amber-700 dark:text-amber-300">{text}</p> : null}
    </div>
  );
}
