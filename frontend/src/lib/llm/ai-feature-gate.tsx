"use client";

/**
 * Central gate for AI features: global enablement, on-device setup wizard,
 * and per-feature cloud consent — before any AI action runs.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LocalAiSetupWizard } from "@/components/llm/local-ai-setup-wizard";
import { CloudConsentDialog } from "@/components/llm/cloud-consent-dialog";
import { useLocalAiSetup } from "@/hooks/use-local-ai-setup";
import { getFeaturePolicy, type FeatureId } from "@/lib/llm/features";
import { useLlm } from "@/lib/llm/useLlm";
import type { Decision } from "@/lib/llm/router";
import { isDemoMode } from "@/lib/demo-mode";
import { appToast } from "@/lib/app-toast";

export type PrepareFeatureResult =
  | { ok: true; decision?: Extract<Decision, { kind: "ready" }> }
  | { ok: false; reason: "cancelled" | "unavailable"; message?: string };

interface CloudConsentWaiter {
  feature: FeatureId;
  resolve: () => void;
  reject: (err: Error) => void;
}

interface AiFeatureGateContextValue {
  /** Run before any AI API call or local LLM use. Opens setup/consent dialogs as needed. */
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
  const qc = useQueryClient();
  const llm = useLlm();
  const localAi = useLocalAiSetup();

  const [cloudConsentOpen, setCloudConsentOpen] = useState(false);
  const [cloudConsentFeature, setCloudConsentFeature] = useState<FeatureId | null>(null);
  const cloudWaiterRef = useRef<CloudConsentWaiter | null>(null);

  const waitForCloudConsent = useCallback((feature: FeatureId) => {
    return new Promise<void>((resolve, reject) => {
      cloudWaiterRef.current = { feature, resolve, reject };
      setCloudConsentFeature(feature);
      setCloudConsentOpen(true);
    });
  }, []);

  const closeCloudConsent = useCallback((cancelled: boolean) => {
    setCloudConsentOpen(false);
    setCloudConsentFeature(null);
    const waiter = cloudWaiterRef.current;
    cloudWaiterRef.current = null;
    if (!waiter) return;
    if (cancelled) {
      waiter.reject(new Error("Cloud AI consent cancelled"));
    }
  }, []);

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

        // Nano is selectable but the browser hasn't fetched the model yet.
        // The router never auto-downloads (Chrome requires a user gesture), so
        // route the user through the same setup wizard the settings card uses
        // — the wizard's grant button is the gesture that starts the download.
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

        if (decision.reason === "needs_download_consent") {
          try {
            await localAi.ensureReady(feature);
            await llm.refresh();
          } catch {
            return { ok: false, reason: "cancelled" };
          }
          decision = await llm.decide(feature);
          continue;
        }

        if (decision.reason === "needs_cloud_consent") {
          try {
            await waitForCloudConsent(feature);
            await qc.refetchQueries({ queryKey: ["llmCloudConsent"] });
          } catch {
            return { ok: false, reason: "cancelled" };
          }
          decision = await llm.decide(feature);
          continue;
        }

        appToast.warning(decision.message);
        return { ok: false, reason: "unavailable", message: decision.message };
      }

      appToast.warning("Could not prepare AI for this feature. Try again from Settings.");
      return { ok: false, reason: "unavailable" };
    },
    [llm, localAi, qc, waitForCloudConsent],
  );

  const cloudLabel =
    cloudConsentFeature !== null ? getFeaturePolicy(cloudConsentFeature).label : "";

  return (
    <AiFeatureGateContext.Provider value={{ prepareFeature, ensureLocalSetup }}>
      {children}
      <LocalAiSetupWizard {...localAi.wizardProps} />
      {cloudConsentFeature !== null && (
        <CloudConsentDialog
          open={cloudConsentOpen}
          feature={cloudConsentFeature}
          featureLabel={cloudLabel}
          onClose={() => closeCloudConsent(true)}
          onGranted={() => {
            cloudWaiterRef.current?.resolve();
            cloudWaiterRef.current = null;
            setCloudConsentOpen(false);
            setCloudConsentFeature(null);
          }}
        />
      )}
    </AiFeatureGateContext.Provider>
  );
}
