import type { PrepareFeatureResult } from "./prepare-feature-types";

export type PrepareInterpretation =
  | { action: "run" }
  | { action: "stop"; userMessage: string; showSettingsLink: boolean };

/** Map prepareFeature outcome to inline UX — gate already toasts unavailable cases. */
export function interpretPrepareFeatureResult(
  prepared: PrepareFeatureResult,
): PrepareInterpretation {
  if (prepared.ok) return { action: "run" };
  if (prepared.reason === "cancelled") {
    return {
      action: "stop",
      userMessage: "On-device AI setup was cancelled. Open AI settings to try again.",
      showSettingsLink: true,
    };
  }
  return {
    action: "stop",
    userMessage: prepared.message ?? "AI is not available for this feature.",
    showSettingsLink: true,
  };
}
