"use client";

import { useCallback, useState } from "react";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLlm } from "@/lib/llm/useLlm";
import type { Transaction } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { CloudConsentDialog } from "./cloud-consent-dialog";
import { DownloadConsentCard } from "./download-consent-card";

interface Props {
  txn: Transaction;
}

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
  const [output, setOutput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<1 | 2 | 4 | null>(null);
  const [showCloudConsent, setShowCloudConsent] = useState(false);
  const [showDownloadConsent, setShowDownloadConsent] = useState(false);

  const run = useCallback(async () => {
    setError(null);
    setOutput("");
    setLoading(true);
    try {
      const decision = await llm.decide("explain_charge");
      if (decision.kind === "unavailable") {
        setError(decision.message);
        setLoading(false);
        return;
      }
      if (decision.kind === "needs_consent") {
        setLoading(false);
        if (decision.reason === "needs_cloud_consent") setShowCloudConsent(true);
        else setShowDownloadConsent(true);
        return;
      }
      setTier(decision.tier);
      const prompt = buildPrompt(txn);
      for await (const chunk of llm.run("explain_charge", prompt, { system: SYSTEM_PROMPT, maxTokens: 200 })) {
        setOutput((prev) => prev + chunk);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [llm, txn]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button onClick={run} disabled={loading} size="sm" variant="outline">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Explain this charge
        </Button>
        {tier !== null && !loading && (
          <Badge variant="secondary" className="text-xs">
            {tier === 1 ? "On-device (Nano)" : tier === 2 ? "On-device" : "Cloud"}
          </Badge>
        )}
      </div>
      {output && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">{output}</div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <CloudConsentDialog
        open={showCloudConsent}
        feature="explain_charge"
        featureLabel="Explain a charge"
        onClose={() => setShowCloudConsent(false)}
        onGranted={() => {
          setShowCloudConsent(false);
          void run();
        }}
      />
      <DownloadConsentCard
        open={showDownloadConsent}
        onClose={() => setShowDownloadConsent(false)}
        onGranted={() => {
          setShowDownloadConsent(false);
          void run();
        }}
      />
    </div>
  );
}
