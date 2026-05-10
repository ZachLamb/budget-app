"use client";

import { useCallback, useState } from "react";
import { Sparkles, Loader2, AlertCircle, Clock, Cpu } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLlm } from "@/lib/llm/useLlm";
import { isLLMError, type LLMError } from "@/lib/llm";
import { getFeaturePolicy } from "@/lib/llm/features";
import { llmApi } from "@/lib/api/llm";
import { toastApiError } from "@/lib/toast-error";
import type { Transaction } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { CloudConsentDialog } from "./cloud-consent-dialog";
import { DownloadConsentCard } from "./download-consent-card";

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

/**
 * True when the feature policy allows a local tier (1 or 2) AND the device
 * can serve it. If neither holds, falling back to on-device is impossible.
 */
function localFallbackAvailable(
  capability: ReturnType<typeof useLlm>["capability"],
): boolean {
  if (!capability) return false;
  const policy = getFeaturePolicy(FEATURE);
  const allowsLocal = policy.allowedTiers.includes(1) || policy.allowedTiers.includes(2);
  if (!allowsLocal) return false;
  const tier1Ready = policy.allowedTiers.includes(1) && capability.nano.available;
  const tier2Ready =
    policy.allowedTiers.includes(2) &&
    capability.webgpu.available &&
    capability.webgpu.modelSize !== "none";
  return tier1Ready || tier2Ready;
}

export function ExplainCharge({ txn }: Props) {
  const llm = useLlm();
  const qc = useQueryClient();
  const [output, setOutput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitError, setRateLimitError] = useState<LLMError | null>(null);
  const [tier, setTier] = useState<1 | 2 | 4 | null>(null);
  const [showCloudConsent, setShowCloudConsent] = useState(false);
  const [showDownloadConsent, setShowDownloadConsent] = useState(false);

  const run = useCallback(async () => {
    setError(null);
    setRateLimitError(null);
    setOutput("");
    setLoading(true);
    try {
      const decision = await llm.decide(FEATURE);
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
      for await (const chunk of llm.run(FEATURE, prompt, { system: SYSTEM_PROMPT, maxTokens: 200 })) {
        setOutput((prev) => prev + chunk);
      }
    } catch (e) {
      if (isLLMError(e) && e.status === 429) {
        setRateLimitError(e);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [llm, txn]);

  const fallbackToLocal = useMutation({
    mutationFn: async () => {
      // Revoke per-feature cloud consent so the router falls through to the
      // highest available local tier on the next decide().
      await llmApi.revokeCloudConsent(FEATURE);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["llmCloudConsent"] });
      setRateLimitError(null);
      void run();
    },
    onError: (e) => {
      toastApiError("Couldn't switch to on-device", e);
    },
  });

  const canFallback = localFallbackAvailable(llm.capability);

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
      {rateLimitError && (
        <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
          <Clock className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="flex-1 space-y-2">
            <div>
              <div className="font-medium">Daily limit reached</div>
              <div className="text-muted-foreground">{rateLimitError.detail}</div>
            </div>
            {canFallback && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => fallbackToLocal.mutate()}
                disabled={fallbackToLocal.isPending}
              >
                {fallbackToLocal.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Cpu className="size-4" />
                )}
                Try on-device
              </Button>
            )}
          </div>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <CloudConsentDialog
        open={showCloudConsent}
        feature={FEATURE}
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
