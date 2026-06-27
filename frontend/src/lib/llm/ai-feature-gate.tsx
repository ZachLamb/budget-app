"use client";

/**
 * Central gate for AI features: global enablement and on-device setup wizard
 * before any AI action runs.
 */

import {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
} from "react";
import { LocalAiSetupWizard } from "@/components/llm/local-ai-setup-wizard";
import { useLocalAiSetup } from "@/hooks/use-local-ai-setup";
import { type FeatureId } from "@/lib/llm/features";
import { useLlm } from "@/lib/llm/useLlm";
import type { Decision } from "@/lib/llm/router";
import { isDemoMode } from "@/lib/demo-mode";
import { appToast } from "@/lib/app-toast";

export type PrepareFeatureResult =
  | { ok: true; decision?: Extract<Decision, { kind: "ready" }> }
  | { ok: false; reason: "cancelled" | "unavailable"; message?: string };

interface AiFeatureGateContextValue {
  /** Run before any AI API call or local LLM use. Opens setup dialogs as needed. */
  prepareFeature: (feature: FeatureId) => Promise<PrepareFeatureResult>;
  /** Ensure local AI model is downloaded and ready for the given feature. */
  ensureLocalSetup: (feature: FeatureId) => Promise<void>;
}

const AiFeatureGateContext = createContext<AiFeatureGateContextValue | null>(null);

export function useAiFeatureGate(): AiFeatureGateContextValue {
  const ctx = useContext(AiFeatureGateContext);
  if (!ctx) {
    throw new Error("useAiFeatureGate must be used within AiFeatureGateProvider");
  }
  return ctx;
}

export function AiFeatureGateProvider({ children }: { children: ReactNode }) {
  const llm = useLlm();
  const localAi = useLocalAiSetup();

  const ensureLocalSetup = useCallback(
    (feature: FeatureId) => localAi.ensureReady(feature),
    [localAi],
  );

  const prepareFeature = useCallback(
    async (feature: FeatureId): Promise<PrepareFeatureResult> => {
      if (isDemoMode) {
        return { ok: true };
      }

      let decision = await llm.decide(feature);

      for (let guard = 0; guard < 8; guard++) {
        if (decision.kind === "ready") {
          return { ok: true, decision };
        }

        if (decision.kind === "unavailable") {
          if (decision.reason === "ai_disabled_globally") {
            appToast.warning(
              "AI is turned off. Enable AI Financial Advisor in Settings to use this feature.",
            );
          } else {
            appToast.warning(decision.message);
          }
          return { ok: false, reason: "unavailable", message: decision.message };
        }

        if (decision.kind === "needs_nano_setup") {
          try {
            await localAi.ensureReady(feature);
            await llm.refresh();
          } catch {
            return { ok: false, reason: "cancelled" };
          }
          decision = await llm.decide(feature);
          continue;
        }

        if (decision.kind === "needs_consent") {
          try {
            await localAi.ensureReady(feature);
            await llm.refresh();
          } catch {
            return { ok: false, reason: "cancelled" };
          }
          decision = await llm.decide(feature);
          continue;
        }
      }

      appToast.warning("Could not prepare AI for this feature. Try again from Settings.");
      return { ok: false, reason: "unavailable" };
    },
    [llm, localAi],
  );

  return (
    <AiFeatureGateContext.Provider value={{ prepareFeature, ensureLocalSetup }}>
      {children}
      <LocalAiSetupWizard {...localAi.wizardProps} />
    </AiFeatureGateContext.Provider>
  );
}
