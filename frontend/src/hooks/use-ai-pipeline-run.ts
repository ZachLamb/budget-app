"use client";

import { useCallback, useRef, useState } from "react";
import { useAiFeatureGate } from "@/lib/llm/ai-feature-gate";
import { demoStreamText } from "@/lib/llm/contracts";
import { OnDeviceError, userMessageFor } from "@/lib/llm/errors";
import type { FeatureId } from "@/lib/llm/features";
import type { PipelineProgress } from "@/lib/llm/pipelines/types";
import { interpretPrepareFeatureResult } from "@/lib/llm/prepare-feature-result";
import { useLlm } from "@/lib/llm/useLlm";
import { isDemoMode } from "@/lib/demo-mode";

/**
 * A cancelled run must never land in `error`. Cancellation reaches us three
 * ways: a raw `AbortError` from fetch, the LLM layer's own
 * `OnDeviceError("aborted")`, or — when a provider swallows the abort and just
 * ends its stream — a downstream parse failure on a truncated response. The
 * controller's own signal is the reliable tiebreaker for that last case.
 */
export function isCancellation(e: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (e instanceof OnDeviceError) return e.code === "aborted";
  // Duck-typed on purpose: fetch rejects with a `DOMException`, which is not an
  // `Error` subclass in every environment.
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

const HEAVY_FEATURES = new Set<FeatureId>([
  "budget_recommendations",
  "goal_planning",
  "free_form_qa",
  "financial_advice",
  "debt_rate_suggestions",
]);

export function useAiPipelineRun<T>(feature: FeatureId) {
  const gate = useAiFeatureGate();
  const llm = useLlm();
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setProgress(null);
    setCancelled(true);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setCancelled(false);
  }, []);

  const run = useCallback(
    async (args: Record<string, unknown> = {}): Promise<T> => {
      if (!HEAVY_FEATURES.has(feature)) {
        throw new Error(`useAiPipelineRun is for heavy pipeline features; got "${feature}"`);
      }

      const prepared = await gate.prepareFeature(feature);
      const interpretation = interpretPrepareFeatureResult(prepared);
      if (interpretation.action === "stop") {
        setError(interpretation.userMessage);
        throw new Error(interpretation.userMessage);
      }

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setRunning(true);
      setError(null);
      setCancelled(false);
      setProgress(null);

      try {
        const result = (await llm.runFeature(feature, args, {
          signal: ac.signal,
          onProgress: setProgress,
        })) as T;
        return result;
      } catch (e) {
        if (isCancellation(e, ac.signal)) {
          setCancelled(true);
          throw e;
        }
        const msg = userMessageFor(e);
        setError(msg);
        throw e;
      } finally {
        // Only tear down if we still own the run. A newer run may already have
        // installed its own controller and set `running` — clearing the ref
        // here would leave that run uncancellable.
        if (abortRef.current === ac) {
          setRunning(false);
          setProgress(null);
          abortRef.current = null;
        }
      }
    },
    [feature, gate, llm],
  );

  const runStream = useCallback(
    async (
      prompt: string,
      onChunk: (text: string) => void,
      opts?: { system?: string; maxTokens?: number },
    ): Promise<void> => {
      if (isDemoMode) {
        for (const ch of demoStreamText(feature)) onChunk(ch);
        return;
      }

      const prepared = await gate.prepareFeature(feature);
      const interpretation = interpretPrepareFeatureResult(prepared);
      if (interpretation.action === "stop") {
        setError(interpretation.userMessage);
        throw new Error(interpretation.userMessage);
      }

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setRunning(true);
      setError(null);
      setCancelled(false);

      try {
        for await (const chunk of llm.run(feature, prompt, {
          system: opts?.system,
          maxTokens: opts?.maxTokens,
          signal: ac.signal,
        })) {
          onChunk(chunk);
        }
      } catch (e) {
        if (isCancellation(e, ac.signal)) {
          setCancelled(true);
          throw e;
        }
        const msg = userMessageFor(e);
        setError(msg);
        throw e;
      } finally {
        if (abortRef.current === ac) {
          setRunning(false);
          abortRef.current = null;
        }
      }
    },
    [feature, gate, llm],
  );

  return {
    run,
    runStream,
    progress,
    running,
    error,
    cancelled,
    cancel,
    clearError,
  };
}
