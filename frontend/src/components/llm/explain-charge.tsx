"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, AlertCircle, Clock, Cpu } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLlm } from "@/lib/llm/useLlm";
import { isLLMError, scanPrompt, type LLMError, type PIIScan } from "@/lib/llm";
import { getFeaturePolicy } from "@/lib/llm/features";
import { llmApi } from "@/lib/api/llm";
import { toastApiError } from "@/lib/toast-error";
import type { Transaction } from "@/lib/api/transactions";
import { formatCurrency } from "@/lib/format";
import { PiiWarningDialog } from "./pii-warning-dialog";
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
  const gate = useAiFeatureGate();
  const qc = useQueryClient();
  const [output, setOutput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitError, setRateLimitError] = useState<LLMError | null>(null);
  const [tier, setTier] = useState<1 | 2 | 4 | null>(null);
  const [piiScan, setPiiScan] = useState<PIIScan | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  // Wall-clock seconds since loading started — drives the progressive
  // "AI is warming up" copy below. We don't know in advance whether the
  // backend or Modal is cold; both can add real seconds. Showing context-
  // aware text means the user knows the request isn't stuck.
  const loadingStartRef = useRef<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const displayElapsedSec = loading ? elapsedSec : 0;
  useEffect(() => {
    if (!loading) {
      loadingStartRef.current = null;
      return;
    }
    if (loadingStartRef.current === null) loadingStartRef.current = Date.now();
    const tick = () => {
      if (loadingStartRef.current === null) return;
      setElapsedSec(Math.floor((Date.now() - loadingStartRef.current) / 1000));
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [loading]);

  const streamPrompt = useCallback(
    async (prompt: string) => {
      setLoading(true);
      try {
        for await (const chunk of llm.run(FEATURE, prompt, {
          system: SYSTEM_PROMPT,
          maxTokens: 200,
        })) {
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
    },
    [llm],
  );

  const run = useCallback(async () => {
    setError(null);
    setRateLimitError(null);
    setOutput("");
    setLoading(true);
    try {
      const prepared = await gate.prepareFeature(FEATURE);
      if (!prepared.ok) {
        setLoading(false);
        if (prepared.reason !== "cancelled" && prepared.message) {
          setError(prepared.message);
        }
        return;
      }
      const decision = prepared.decision ?? (await llm.decide(FEATURE));
      if (decision.kind !== "ready") {
        setError(decision.message);
        setLoading(false);
        return;
      }
      setTier(decision.tier);
      const prompt = buildPrompt(txn);

      // Cloud tier: scan for PII patterns and let the user abort if any of
      // their text looks like an SSN, card, email, or phone. Tier 1/2 stay
      // on-device, so no warning is needed.
      if (decision.tier === 4) {
        const scan = scanPrompt(prompt);
        if (scan.flags.length > 0) {
          setPiiScan(scan);
          setPendingPrompt(prompt);
          setLoading(false);
          return;
        }
      }

      await streamPrompt(prompt);
    } catch (e) {
      if (isLLMError(e) && e.status === 429) {
        setRateLimitError(e);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setLoading(false);
    }
  }, [gate, llm, txn, streamPrompt]);

  const cancelPii = useCallback(() => {
    setPiiScan(null);
    setPendingPrompt(null);
    setLoading(false);
  }, []);

  const sendPiiAnyway = useCallback(() => {
    const prompt = pendingPrompt;
    setPiiScan(null);
    setPendingPrompt(null);
    if (prompt !== null) void streamPrompt(prompt);
  }, [pendingPrompt, streamPrompt]);

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

  // Progressive cold-start copy. The thresholds are tuned for the worst
  // realistic path: a cold Fly machine (5–10s) followed by a cold Modal
  // GPU spin-up (60–90s) on the first Tier 4 call after either has been
  // idle. The text never lies — if no output has streamed in 25s, the
  // cloud server is almost certainly warming.
  let loadingHint: string | null = null;
  if (loading && output.length === 0) {
    if (displayElapsedSec >= 60) {
      loadingHint = "Still working — cold start can take ~90s. Future requests will be fast.";
    } else if (displayElapsedSec >= 25) {
      loadingHint = "The AI server is warming up from sleep — this only happens after long idle.";
    } else if (displayElapsedSec >= 10) {
      loadingHint = "Setting up cloud AI — the first request can be slow.";
    } else if (displayElapsedSec >= 3) {
      loadingHint = "Working on it…";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button onClick={run} disabled={loading} size="sm" variant="outline">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Explain this charge
        </Button>
        {loadingHint && (
          <span className="text-xs text-muted-foreground">{loadingHint}</span>
        )}
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

      {piiScan && (
        <PiiWarningDialog
          open={piiScan !== null}
          scan={piiScan}
          onCancel={cancelPii}
          onSendAnyway={sendPiiAnyway}
        />
      )}
    </div>
  );
}
