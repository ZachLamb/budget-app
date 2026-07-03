"use client";

import { useCallback, useRef, useState } from "react";
import { aiApi, type FsaReviewResponse } from "@/lib/api/ai";
import type { FsaCandidateRow } from "@/lib/llm/contracts";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";
import { useLlm } from "@/lib/llm/useLlm";
import { fsaBatchConfig, runBatchedStructuredJson } from "@/lib/llm/run-structured";
import { FSA_SYSTEM_PROMPT, buildFsaBatchPrompt, formatFsaCandidateLine } from "@/lib/llm/prompts/fsa";
import { getCapability } from "@/lib/llm/capability";

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export function buildEligibleFromBatches(
  candidates: FsaCandidateRow[],
  batchSize: number,
  batchResults: ({ eligible: { index: number; confidence: "high" | "medium" | "low"; fsa_category: string; reason: string }[] } | null)[],
): FsaReviewResponse["eligible_transactions"] {
  const eligible: FsaReviewResponse["eligible_transactions"] = [];
  for (let b = 0; b < batchResults.length; b++) {
    const batch = batchResults[b];
    if (!batch) continue; // failed batch — its slice contributes nothing
    const slice = candidates.slice(b * batchSize, b * batchSize + batchSize);
    for (const item of batch.eligible) {
      if (item.index < 0 || item.index >= slice.length) continue;
      const row = slice[item.index]!;
      eligible.push({
        transaction_id: row.transaction_id,
        date: row.date,
        payee_name: row.payee_name,
        category_name: row.category_name,
        amount: row.amount,
        confidence: item.confidence,
        fsa_category: item.fsa_category,
        reason: item.reason,
        status: row.status ?? "pending",
      });
    }
  }
  return eligible;
}

export function useFsaReviewScan(params: {
  dateFrom: string;
  dateTo: string;
  includeAllOutflows: boolean;
}) {
  const gate = useAiFeatureGate();
  const llm = useLlm();
  const [data, setData] = useState<FsaReviewResponse | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tier, setTier] = useState<1 | 2 | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setBatchProgress(null);
  }, []);

  const scanLocal = useCallback(async () => {
    const prepared = await gate.prepareFeature("fsa_review");
    if (!prepared.ok) {
      throw new Error(
        prepared.reason === "cancelled"
          ? "On-device AI setup was cancelled"
          : prepared.message ?? "AI is not available for FSA review",
      );
    }
    const decision = prepared.decision ?? (await llm.decide("fsa_review"));
    if (decision.kind !== "ready") {
      throw new Error(decision.message);
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    setBatchProgress(null);

    try {
      const fetched = await aiApi.getFsaReviewCandidates({
        date_from: params.dateFrom,
        date_to: params.dateTo,
        include_all_outflows: params.includeAllOutflows,
      });

      const cap = await getCapability();
      const mobile = isMobileDevice() || cap.webgpu.modelSize === "1b";
      const { batchSize, maxCandidates } = fsaBatchConfig(fetched.candidates.length, mobile);
      const candidates = fetched.candidates.slice(0, maxCandidates) as FsaCandidateRow[];

      if (candidates.length === 0) {
        setData({
          eligible_transactions: [],
          total_potential_amount: 0,
          scan_count: fetched.scan_count,
          model_source: "none",
          parse_errors: 0,
          llm_batch_failures: 0,
          candidate_count: 0,
          prefilter_skipped_count: fetched.prefilter_skipped_count,
        });
        setTier(decision.tier as 1 | 2);
        return;
      }

      const batches = [];
      for (let i = 0; i < candidates.length; i += batchSize) {
        const slice = candidates.slice(i, i + batchSize);
        const lines = slice.map((row, idx) => formatFsaCandidateLine(idx, row));
        batches.push({
          system: FSA_SYSTEM_PROMPT,
          prompt: buildFsaBatchPrompt(lines),
        });
      }

      const ctx = llm.getContext("fsa_review");
      const batched = await runBatchedStructuredJson("fsa_review", ctx, {
        batches,
        signal: ac.signal,
        onProgress: (done, total) => setBatchProgress({ done, total }),
      });

      const eligible = buildEligibleFromBatches(candidates, batchSize, batched.results);
      const total = eligible.reduce((s, t) => s + t.amount, 0);

      setData({
        eligible_transactions: eligible,
        total_potential_amount: Math.round(total * 100) / 100,
        scan_count: fetched.scan_count,
        model_source: batched.tier === 1 ? "nano" : "web-llm",
        parse_errors: batched.parseErrors,
        llm_batch_failures: batched.batchFailures,
        candidate_count: candidates.length,
        prefilter_skipped_count: fetched.prefilter_skipped_count,
      });
      setTier(batched.tier);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e);
    } finally {
      setLoading(false);
      setBatchProgress(null);
      abortRef.current = null;
    }
  }, [gate, llm, params]);

  return {
    data,
    loading,
    error,
    tier,
    batchProgress,
    scanLocal,
    cancel,
    setData,
  };
}
