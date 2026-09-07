"use client";

import { useCallback, useState } from "react";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";
import { useLlm } from "@/lib/llm/useLlm";
import { parseJsonResponse } from "@/lib/llm/contracts";
import { userMessageFor } from "@/lib/llm/errors";
import { collectAcceptedRefinements } from "@/lib/llm/refine-merchant-name";
import { isDemoMode } from "@/lib/demo-mode";

export interface RefineItem {
  /** Stable id echoed back by the model. */
  id: string;
  /** The raw descriptor(s) the clean name must be derived from. */
  sourceText: string;
  /** The current deterministic name — kept when a proposal is unsafe. */
  current: string;
}

const SYSTEM =
  "You clean up noisy bank/merchant descriptors into a short, human display name. " +
  "You never invent a merchant: only reuse words that appear in the descriptor, fixing casing " +
  "and dropping payment-processor noise and store numbers.";

/**
 * On-device refinement of merchant names. Gated behind the categorization
 * feature; returns a map of id → accepted clean name (only safe, changed ones).
 * Always best-effort: on unavailability, demo mode, or any error it resolves to
 * an empty map so callers keep their deterministic values.
 */
export function useMerchantNameRefine() {
  const gate = useAiFeatureGate();
  const llm = useLlm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refine = useCallback(
    async (items: RefineItem[]): Promise<Record<string, string>> => {
      setError(null);
      if (items.length === 0) return {};
      // On-device refinement needs a real model; the demo has none.
      if (isDemoMode) {
        setError("AI name cleanup runs on-device — not available in the demo.");
        return {};
      }

      setLoading(true);
      try {
        const prepared = await gate.prepareFeature("categorize_transaction");
        if (!prepared.ok) {
          setError(prepared.message ?? "On-device AI is unavailable.");
          return {};
        }

        const payload = items.map((i) => ({ id: i.id, descriptor: i.sourceText }));
        const prompt =
          "For each descriptor below, return a JSON array of " +
          '{ "id": string, "name": string } with a clean display name built only ' +
          "from words in that descriptor. Return only JSON.\n" +
          JSON.stringify(payload);

        let out = "";
        for await (const chunk of llm.run("categorize_transaction", prompt, {
          system: SYSTEM,
          maxTokens: 256,
        })) {
          out += chunk;
        }

        let parsed: unknown;
        try {
          parsed = parseJsonResponse(out);
        } catch {
          setError("Couldn't read the AI response — keeping your names.");
          return {};
        }
        return collectAcceptedRefinements(items, parsed);
      } catch (err) {
        if ((err as Error).name === "AbortError") return {};
        setError(userMessageFor(err));
        return {};
      } finally {
        setLoading(false);
      }
    },
    [gate, llm],
  );

  return { refine, loading, error, clearError: () => setError(null) };
}
