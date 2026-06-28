"use client";

/**
 * Central gate for AI features: global enablement and on-device setup wizard
 * before any AI action runs.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LocalAiSetupWizard } from "@/components/llm/local-ai-setup-wizard";
import { OnDeviceAiHelpDialog } from "@/components/llm/on-device-ai-help-dialog";
import { useLocalAiSetup } from "@/hooks/use-local-ai-setup";
import type { LocalSetupSnapshot } from "@/hooks/local-ai-setup-types";
import { type FeatureId } from "@/lib/llm/features";
import { useLlm } from "@/lib/llm/useLlm";
import type { Decision } from "@/lib/llm/router";
import { isDemoMode } from "@/lib/demo-mode";
import { toastAiAvailability } from "@/lib/llm/ai-toast";
import { AI_SETTINGS_PATH } from "@/lib/llm/ai-settings-link";

export type PrepareFeatureResult =
  | { ok: true; decision?: Extract<Decision, { kind: "ready" }> }
  | { ok: false; reason: "cancelled" | "unavailable"; message?: string };

interface AiFeatureGateContextValue {
  /** Run before any AI API call or local LLM use. Opens setup dialogs as needed. */
  prepareFeature: (feature: FeatureId) => Promise<PrepareFeatureResult>;
  /** Ensure local AI model is downloaded and ready for the given feature. */
  ensureLocalSetup: (feature: FeatureId) => Promise<void>;
  /** Open the help walkthrough (browser requirements, no PWA needed). */
  openOnDeviceHelp: (detail?: string) => void;
  /** Live wizard state for inline progress in Settings / help UI. */
  localSetup: LocalSetupSnapshot;
  aiSettingsPath: string;
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpDetail, setHelpDetail] = useState<string | undefined>();

  const localSetup = useMemo((): LocalSetupSnapshot => {
    const wp = localAi.wizardProps;
    return {
      progress: wp.progress,
      progressText: wp.progressText,
      step: wp.step,
      open: wp.open,
      setupPath: wp.setupPath,
      nanoStatus: wp.nanoStatus,
      verifyStatus: wp.verifyStatus,
      isDownloading: wp.open && wp.step === "download",
    };
  }, [localAi.wizardProps]);

  const openOnDeviceHelp = useCallback((detail?: string) => {
    setHelpDetail(detail);
    setHelpOpen(true);
  }, []);

  const ensureLocalSetup = useCallback(
    (_feature: FeatureId) => {
      void _feature;
      return localAi.ensureReady();
    },
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
            toastAiAvailability(
              "AI is turned off. Enable AI Financial Advisor in Settings to use this feature.",
            );
          } else if (decision.reason === "unavailable_no_capable_tier") {
            openOnDeviceHelp(decision.message);
          } else {
            toastAiAvailability(decision.message);
          }
          return { ok: false, reason: "unavailable", message: decision.message };
        }

        if (decision.kind === "needs_nano_setup") {
          try {
            await localAi.ensureReady();
            await llm.refresh();
          } catch {
            return { ok: false, reason: "cancelled" };
          }
          decision = await llm.decide(feature);
          continue;
        }

        if (decision.kind === "needs_consent") {
          try {
            await localAi.ensureReady();
            await llm.refresh();
          } catch {
            return { ok: false, reason: "cancelled" };
          }
          decision = await llm.decide(feature);
          continue;
        }
      }

      toastAiAvailability("Could not prepare AI for this feature. Check AI settings and try again.");
      return { ok: false, reason: "unavailable" };
    },
    [llm, localAi, openOnDeviceHelp],
  );

  return (
    <AiFeatureGateContext.Provider
      value={{
        prepareFeature,
        ensureLocalSetup,
        openOnDeviceHelp,
        localSetup,
        aiSettingsPath: AI_SETTINGS_PATH,
      }}
    >
      {children}
      <LocalAiSetupWizard {...localAi.wizardProps} />
      <OnDeviceAiHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        detail={helpDetail}
        localSetup={localSetup}
        onActivate={() => localAi.ensureReady()}
        onStartSetup={() => {
          setHelpOpen(false);
          void localAi.ensureReady();
        }}
      />
    </AiFeatureGateContext.Provider>
  );
}
