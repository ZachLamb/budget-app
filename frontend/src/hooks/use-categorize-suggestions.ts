"use client";

import { useCallback, useState } from "react";
import { reportsApi, type LlmSuggestion, type SuggestCategoriesParams } from "@/lib/api/reports";
import { isDemoMode } from "@/lib/demo-mode";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";
import { useLlm } from "@/lib/llm/useLlm";
import { runStructuredJson } from "@/lib/llm/run-structured";
import type { CategorizeSuggestion } from "@/lib/llm/contracts";
import { CATEGORIZE_SYSTEM_PROMPT, buildCategorizePrompt } from "@/lib/llm/prompts/categorize";

export function useCategorizeSuggestions() {
  const gate = useAiFeatureGate();
  const llm = useLlm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<1 | 2 | null>(null);

  const suggestLocal = useCallback(
    async (params?: SuggestCategoriesParams): Promise<LlmSuggestion[]> => {
      setLoading(true);
      setError(null);
      try {
        const payload = await reportsApi.getCategorizeCandidates(params);
        if (payload.transactions.length === 0) return [];

        const prompt = buildCategorizePrompt(payload.categories, payload.transactions);
        const ctx = llm.getContext("categorize_transaction");
        const { data: suggestions, tier: usedTier } = await runStructuredJson<CategorizeSuggestion[]>(
          "categorize_transaction",
          ctx,
          {
            system: CATEGORIZE_SYSTEM_PROMPT,
            prompt,
            maxTokens: 2048,
          },
        );

        const catById = new Map(payload.categories.map((c) => [c.id, c.name]));
        const txnById = new Map(payload.transactions.map((t) => [t.id, t.payee]));
        const valid = new Set(payload.categories.map((c) => c.id));

        const out: LlmSuggestion[] = [];
        for (const s of suggestions) {
          if (!valid.has(s.category_id)) continue;
          const payee = txnById.get(s.transaction_id) ?? "Unknown";
          const catName = catById.get(s.category_id) ?? "Unknown";
          out.push({
            transaction_id: s.transaction_id,
            suggested_category_id: s.category_id,
            payee_name: payee,
            category_name: catName,
          });
        }
        setTier(usedTier);
        return out;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Local categorization failed");
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [llm],
  );

  const suggest = useCallback(
    async (params?: SuggestCategoriesParams): Promise<LlmSuggestion[]> => {
      if (isDemoMode) return suggestLocal(params);

      const prepared = await gate.prepareFeature("categorize_transaction");
      if (!prepared.ok) {
        throw new Error(
          prepared.reason === "cancelled"
            ? "On-device AI setup was cancelled"
            : prepared.message ?? "AI is not available for categorization",
        );
      }
      return suggestLocal(params);
    },
    [gate, suggestLocal],
  );

  return { suggest, suggestLocal, loading, error, tier };
}
