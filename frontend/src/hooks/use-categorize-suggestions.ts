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
import { maxTokensFor } from "@/lib/llm/max-tokens";
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

type RunScope = {
  runId: number;
  ac: AbortController;
  isCurrent: () => boolean;
  setProgressSafe: (p: PipelineProgress | null) => void;
  setBatchProgressSafe: (b: { done: number; total: number } | null) => void;
  setTierSafe: (t: 1 | 2) => void;
  finish: () => void;
};

export function useCategorizeSuggestions() {
  const gate = useAiFeatureGate();
  const llm = useLlm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<1 | 2 | null>(null);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  const beginRun = useCallback((): RunScope => {
    abortRef.current?.abort();
    const runId = ++runIdRef.current;
    const ac = new AbortController();
    abortRef.current = ac;

    const isCurrent = () => runIdRef.current === runId;

    return {
      runId,
      ac,
      isCurrent,
      setProgressSafe: (p) => {
        if (isCurrent()) setProgress(p);
      },
      setBatchProgressSafe: (b) => {
        if (isCurrent()) setBatchProgress(b);
      },
      setTierSafe: (t) => {
        if (isCurrent()) setTier(t);
      },
      finish: () => {
        if (!isCurrent()) return;
        setLoading(false);
        setProgress(null);
        setBatchProgress(null);
        abortRef.current = null;
      },
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    runIdRef.current += 1;
    abortRef.current = null;
    setLoading(false);
    setProgress(null);
    setBatchProgress(null);
  }, []);

  const runInference = useCallback(
    async (
      params: SuggestCategoriesParams | undefined,
      scope: RunScope,
    ): Promise<LlmSuggestion[]> => {
      scope.setProgressSafe({ step: "fetch", label: "Loading uncategorized transactions…" });
      scope.setBatchProgressSafe(null);

      const payload = await reportsApi.getCategorizeCandidates(params, scope.ac.signal);
      if (scope.ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!scope.isCurrent()) throw new DOMException("Aborted", "AbortError");
      if (payload.transactions.length === 0) return [];

      const prefilled = mapSuggestions(
        payload.prefilled_suggestions ?? [],
        payload.categories,
        payload.transactions,
      );
      const prefilledIds = new Set(prefilled.map((s) => s.transaction_id));
      const needsLlm = payload.transactions.filter((t) => !prefilledIds.has(t.id));
      if (needsLlm.length === 0) return prefilled;

      const ctx = llm.getContext("categorize_transaction");
      const batches: typeof needsLlm[] = [];
      for (let i = 0; i < needsLlm.length; i += CATEGORIZE_BATCH_SIZE) {
        batches.push(needsLlm.slice(i, i + CATEGORIZE_BATCH_SIZE));
      }

      const total = batches.length;
      const merged: LlmSuggestion[] = [...prefilled];
      let usedTier: 1 | 2 = 2;

      for (let i = 0; i < total; i++) {
        if (scope.ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (!scope.isCurrent()) throw new DOMException("Aborted", "AbortError");

        const slice = batches[i]!;
        scope.setBatchProgressSafe(total > 1 ? { done: i, total } : null);
        scope.setProgressSafe({
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
            maxTokens: maxTokensFor("categorize_transaction"),
            signal: scope.ac.signal,
          },
        );
        usedTier = batchTier;
        merged.push(...mapSuggestions(suggestions, payload.categories, slice));
      }

      if (total > 1) {
        scope.setBatchProgressSafe({ done: total, total });
      }
      scope.setTierSafe(usedTier);
      return merged;
    },
    [llm],
  );

  const suggestLocal = useCallback(
    async (params?: SuggestCategoriesParams): Promise<LlmSuggestion[]> => {
      const scope = beginRun();
      setLoading(true);
      setError(null);

      try {
        return await runInference(params, scope);
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        if (scope.isCurrent()) {
          const msg = userMessageFor(e);
          setError(msg);
          reportInlineError(msg);
        }
        throw e;
      } finally {
        scope.finish();
      }
    },
    [beginRun, runInference],
  );

  const suggest = useCallback(
    async (params?: SuggestCategoriesParams): Promise<LlmSuggestion[]> => {
      if (isDemoMode) return suggestLocal(params);

      const scope = beginRun();
      setLoading(true);
      setError(null);
      scope.setProgressSafe({ step: "setup", label: "Preparing on-device AI…" });
      scope.setBatchProgressSafe(null);

      try {
        const prepared = await gate.prepareFeature("categorize_transaction");
        if (scope.ac.signal.aborted || !scope.isCurrent()) {
          throw new DOMException("Aborted", "AbortError");
        }

        const interpretation = interpretPrepareFeatureResult(prepared);
        if (interpretation.action === "stop") {
          if (scope.isCurrent()) {
            setError(interpretation.userMessage);
            reportInlineError(interpretation.userMessage);
          }
          throw new Error(interpretation.userMessage);
        }

        return await runInference(params, scope);
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        if (scope.isCurrent()) {
          const msg = userMessageFor(e);
          setError((prev) => prev ?? msg);
          reportInlineError(msg);
        }
        throw e;
      } finally {
        scope.finish();
      }
    },
    [gate, runInference, suggestLocal, beginRun],
  );

  return { suggest, suggestLocal, loading, error, tier, progress, batchProgress, cancel };
}
