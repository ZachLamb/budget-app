"use client";

import { useCallback, useRef, useState } from "react";
import { reportsApi, type LlmSuggestion, type SuggestCategoriesParams } from "@/lib/api/reports";
import { isDemoMode } from "@/lib/demo-mode";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";
import { userMessageFor } from "@/lib/llm/errors";
import { reportInlineError } from "@/lib/report-inline-error";
import { interpretPrepareFeatureResult } from "@/lib/llm/prepare-feature-result";
import { useLlm } from "@/lib/llm/useLlm";
import { runStructuredJson } from "@/lib/llm/run-structured";
import type { CategorizeSuggestion } from "@/lib/llm/contracts";
import { CATEGORIZE_SYSTEM_PROMPT, buildCategorizePrompt } from "@/lib/llm/prompts/categorize";
import type { PipelineProgress } from "@/lib/llm/pipelines/types";

const CATEGORIZE_BATCH_SIZE = 15;

function mapSuggestions(
  raw: CategorizeSuggestion[],
  categories: { id: string; name: string }[],
  transactions: { id: string; payee: string }[],
): LlmSuggestion[] {
  const catById = new Map(categories.map((c) => [c.id, c.name]));
  const txnById = new Map(transactions.map((t) => [t.id, t.payee]));
  const valid = new Set(categories.map((c) => c.id));

  const out: LlmSuggestion[] = [];
  for (const s of raw) {
    if (!valid.has(s.category_id)) continue;
    out.push({
      transaction_id: s.transaction_id,
      suggested_category_id: s.category_id,
      payee_name: txnById.get(s.transaction_id) ?? "Unknown",
      category_name: catById.get(s.category_id) ?? "Unknown",
    });
  }
  return out;
}

export function useCategorizeSuggestions() {
  const gate = useAiFeatureGate();
  const llm = useLlm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<1 | 2 | null>(null);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setProgress(null);
    setBatchProgress(null);
  }, []);

  const runInference = useCallback(
    async (params: SuggestCategoriesParams | undefined, ac: AbortController): Promise<LlmSuggestion[]> => {
      setProgress({ step: "fetch", label: "Loading uncategorized transactions…" });
      setBatchProgress(null);

      const payload = await reportsApi.getCategorizeCandidates(params, ac.signal);
      if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (payload.transactions.length === 0) return [];

      const ctx = llm.getContext("categorize_transaction");
      const batches: typeof payload.transactions[] = [];
      for (let i = 0; i < payload.transactions.length; i += CATEGORIZE_BATCH_SIZE) {
        batches.push(payload.transactions.slice(i, i + CATEGORIZE_BATCH_SIZE));
      }

      const total = batches.length;
      const merged: LlmSuggestion[] = [];
      let usedTier: 1 | 2 = 2;

      for (let i = 0; i < total; i++) {
        if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");

        const slice = batches[i]!;
        setBatchProgress(total > 1 ? { done: i, total } : null);
        setProgress({
          step: "analyze",
          label:
            total > 1
              ? `Analyzing batch ${i + 1} of ${total} (${slice.length} transactions)…`
              : `Analyzing ${slice.length} transaction${slice.length === 1 ? "" : "s"}…`,
        });

        const prompt = buildCategorizePrompt(payload.categories, slice);
        const { data: suggestions, tier: batchTier } = await runStructuredJson<CategorizeSuggestion[]>(
          "categorize_transaction",
          ctx,
          {
            system: CATEGORIZE_SYSTEM_PROMPT,
            prompt,
            maxTokens: 2048,
            signal: ac.signal,
          },
        );
        usedTier = batchTier;
        merged.push(...mapSuggestions(suggestions, payload.categories, slice));
      }

      if (total > 1) {
        setBatchProgress({ done: total, total });
      }
      setTier(usedTier);
      return merged;
    },
    [llm],
  );

  const suggestLocal = useCallback(
    async (params?: SuggestCategoriesParams): Promise<LlmSuggestion[]> => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setLoading(true);
      setError(null);

      try {
        return await runInference(params, ac);
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        const msg = userMessageFor(e);
        setError(msg);
        reportInlineError(msg);
        throw e;
      } finally {
        setLoading(false);
        setProgress(null);
        setBatchProgress(null);
        abortRef.current = null;
      }
    },
    [runInference],
  );

  const suggest = useCallback(
    async (params?: SuggestCategoriesParams): Promise<LlmSuggestion[]> => {
      if (isDemoMode) return suggestLocal(params);

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setLoading(true);
      setError(null);
      setProgress({ step: "setup", label: "Preparing on-device AI…" });
      setBatchProgress(null);

      try {
        const prepared = await gate.prepareFeature("categorize_transaction");
        if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");

        const interpretation = interpretPrepareFeatureResult(prepared);
        if (interpretation.action === "stop") {
          setError(interpretation.userMessage);
          reportInlineError(interpretation.userMessage);
          throw new Error(interpretation.userMessage);
        }

        return await runInference(params, ac);
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        const msg = userMessageFor(e);
        setError((prev) => prev ?? msg);
        reportInlineError(msg);
        throw e;
      } finally {
        setLoading(false);
        setProgress(null);
        setBatchProgress(null);
        abortRef.current = null;
      }
    },
    [gate, runInference, suggestLocal],
  );

  return { suggest, suggestLocal, loading, error, tier, progress, batchProgress, cancel };
}
