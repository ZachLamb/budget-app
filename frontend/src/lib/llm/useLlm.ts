"use client";

/**
 * React hook that wires the LLM router to auth and settings.
 *
 * Usage:
 *   const llm = useLlm();
 *   const decision = await llm.decide("explain_charge");
 *   if (decision.kind === "ready") for await (const chunk of llm.run("explain_charge", prompt)) ...
 *   else if (decision.kind === "needs_consent") ...show download dialog...
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isDemoMode } from "@/lib/demo-mode";
import { settingsApi } from "@/lib/api/settings";
import type { FeatureId } from "./features";
import type { CapabilitySnapshot, LLMProvider } from "./types";
import type { Decision, RouterContext } from "./router";
import { decide as routerDecide } from "./router";
import { getCapability } from "./capability";
import { nanoProvider } from "./providers/nano";
import { getWebLlmProvider } from "./providers/web-llm";
import { demoStructuredResult } from "./contracts";
import type { PipelineContext, PipelineProgress } from "./pipelines/types";
import { runBudgetPipeline } from "./pipelines/budget";
import { runGoalPipeline } from "./pipelines/goal";
import { runQaPipeline } from "./pipelines/qa";
import { runAdvicePipeline } from "./pipelines/advice";
import { runRatesPipeline } from "./pipelines/rates";
import { resolveCascadeProviders } from "./cascade";

/** Heavy features served by on-device pipelines (Nano-only in v1). */
export const HEAVY_FEATURES: ReadonlySet<FeatureId> = new Set<FeatureId>([
  "budget_recommendations",
  "goal_planning",
  "free_form_qa",
  "financial_advice",
  "debt_rate_suggestions",
]);

export interface RunFeatureParams {
  /** Free-text question for `free_form_qa` / `financial_advice`. */
  question?: string;
  /** Target a specific goal for `goal_planning`. */
  goalId?: string;
}

export interface RunFeatureOptions {
  signal?: AbortSignal;
  onProgress?: (p: PipelineProgress) => void;
}

interface AiSettings {
  ai_enabled?: boolean;
}

export interface UseLlm {
  capability: CapabilitySnapshot | null;
  /** Router context for structured runners and custom flows. */
  getContext: (feature: FeatureId) => RouterContext;
  /** Pre-flight — what'll happen for this feature right now. */
  decide: (feature: FeatureId) => Promise<Decision>;
  /** Stream chunks. Throws if consent is missing — call `decide` first to handle that. */
  run: (
    feature: FeatureId,
    prompt: string,
    opts?: { system?: string; maxTokens?: number; signal?: AbortSignal },
  ) => AsyncIterable<string>;
  /**
   * Run a heavy feature through its on-device pipeline (ground → generate →
   * verify). Returns the verified structured result. In demo mode returns a
   * canned result. Throws `OnDeviceError` on failure. Light features must use
   * `run`/structured runners instead.
   */
  runFeature: (
    feature: FeatureId,
    params?: RunFeatureParams,
    opts?: RunFeatureOptions,
  ) => Promise<unknown>;
  /** Force a fresh capability re-probe. */
  refresh: () => Promise<void>;
}

export function useLlm(): UseLlm {
  const [capability, setCapability] = useState<CapabilitySnapshot | null>(null);

  useEffect(() => {
    let mounted = true;
    getCapability().then((c) => {
      if (mounted) setCapability(c);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const aiSettings = useQuery({
    queryKey: ["aiSettings"],
    queryFn: () => settingsApi.getAiSettings(),
    staleTime: 60_000,
  });

  const buildContext = useCallback(
    (): RouterContext => ({
      aiEnabledGlobally: Boolean(
        (aiSettings.data as AiSettings | undefined)?.ai_enabled,
      ),
      providers: {
        nano: async (): Promise<LLMProvider> => nanoProvider,
        webLlm: async (): Promise<LLMProvider> => getWebLlmProvider(),
      },
    }),
    [aiSettings.data],
  );

  const decide = useCallback(
    async (feature: FeatureId): Promise<Decision> =>
      routerDecide(feature, buildContext()),
    [buildContext],
  );

  const run = useCallback(
    (
      feature: FeatureId,
      prompt: string,
      opts?: { system?: string; maxTokens?: number; signal?: AbortSignal },
    ): AsyncIterable<string> => {
      const ctx = buildContext();
      async function* gen(): AsyncIterable<string> {
        const decision = await routerDecide(feature, ctx);
        if (decision.kind !== "ready") throw new Error(decision.message);
        yield* decision.provider.generate(prompt, opts);
      }
      return gen();
    },
    [buildContext],
  );

  const runFeature = useCallback(
    async (
      feature: FeatureId,
      params?: RunFeatureParams,
      opts?: RunFeatureOptions,
    ): Promise<unknown> => {
      if (!HEAVY_FEATURES.has(feature)) {
        throw new Error(
          `runFeature is only for heavy pipeline features; got "${feature}"`,
        );
      }
      if (isDemoMode) return demoStructuredResult(feature);

      const cap = capability ?? (await getCapability());
      const cascade = await resolveCascadeProviders(feature, buildContext(), cap);
      const pctx: PipelineContext = {
        provider: cascade.primary,
        cascade,
        capability: cap,
        signal: opts?.signal,
        onProgress: opts?.onProgress,
      };
      switch (feature) {
        case "budget_recommendations":
          return runBudgetPipeline(pctx);
        case "goal_planning":
          return runGoalPipeline(pctx, { goalId: params?.goalId });
        case "debt_rate_suggestions":
          return runRatesPipeline(pctx);
        case "free_form_qa":
          return runQaPipeline(pctx, { question: params?.question ?? "" });
        case "financial_advice":
          return runAdvicePipeline(pctx, { question: params?.question ?? "" });
        default:
          throw new Error(`Unhandled heavy feature "${feature}"`);
      }
    },
    [buildContext, capability],
  );

  const refresh = useCallback(async () => {
    const c = await getCapability(true);
    setCapability(c);
  }, []);

  const getContext = useCallback(
    () => buildContext(),
    [buildContext],
  );

  return { capability, getContext, decide, run, runFeature, refresh };
}
