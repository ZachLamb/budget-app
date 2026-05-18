"use client";

/**
 * React hook that wires the LLM router to auth, settings, and cloud consent.
 *
 * Usage:
 *   const llm = useLlm();
 *   const decision = await llm.decide("explain_charge");
 *   if (decision.kind === "ready") for await (const chunk of llm.run("explain_charge", prompt)) ...
 *   else if (decision.kind === "needs_consent") ...show dialog...
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/providers";
import { settingsApi } from "@/lib/api/settings";
import { llmApi } from "@/lib/api/llm";
import type { FeatureId } from "./features";
import type { CapabilitySnapshot, LLMProvider } from "./types";
import type { Decision, RouterContext } from "./router";
import { decide as routerDecide } from "./router";
import { getCapability } from "./capability";
import { nanoProvider } from "./providers/nano";
import { getWebLlmProvider } from "./providers/web-llm";
import { makeServerProvider } from "./providers/server";

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
  /** Force a fresh capability re-probe. */
  refresh: () => Promise<void>;
}

export function useLlm(): UseLlm {
  const { user } = useAuth();

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

  const grants = useQuery({
    queryKey: ["llmCloudConsent"],
    queryFn: () => llmApi.listCloudConsent(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const buildContext = useCallback(
    (feature: FeatureId): RouterContext => ({
      aiEnabledGlobally: Boolean((aiSettings.data as AiSettings | undefined)?.ai_enabled),
      cloudConsentGrants: new Set<FeatureId>(
        (grants.data ?? []).filter((g) => !g.revokedAt).map((g) => g.feature as FeatureId),
      ),
      providers: {
        nano: async (): Promise<LLMProvider> => nanoProvider,
        webLlm: async (): Promise<LLMProvider> => getWebLlmProvider(),
        server: async (): Promise<LLMProvider> => makeServerProvider(feature, () => null),
      },
    }),
    [aiSettings.data, grants.data],
  );

  const decide = useCallback(
    async (feature: FeatureId): Promise<Decision> => routerDecide(feature, buildContext(feature)),
    [buildContext],
  );

  const run = useCallback(
    (
      feature: FeatureId,
      prompt: string,
      opts?: { system?: string; maxTokens?: number; signal?: AbortSignal },
    ): AsyncIterable<string> => {
      const ctx = buildContext(feature);
      async function* gen(): AsyncIterable<string> {
        const decision = await routerDecide(feature, ctx);
        if (decision.kind !== "ready") throw new Error(decision.message);
        yield* decision.provider.generate(prompt, opts);
      }
      return gen();
    },
    [buildContext],
  );

  const refresh = useCallback(async () => {
    const c = await getCapability(true);
    setCapability(c);
  }, []);

  const getContext = useCallback(
    (feature: FeatureId) => buildContext(feature),
    [buildContext],
  );

  return { capability, getContext, decide, run, refresh };
}
