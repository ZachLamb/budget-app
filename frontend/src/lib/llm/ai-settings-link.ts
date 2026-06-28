/** Deep link to the on-device AI block on Settings. */
export const AI_SETTINGS_PATH = "/settings#ai";

export function openAiSettings(): void {
  if (typeof window !== "undefined") {
    window.location.assign(AI_SETTINGS_PATH);
  }
}

/** Heuristic: message is about on-device AI availability, not a generic API failure. */
export function isAiAvailabilityMessage(message: string): boolean {
  return /on-device|chrome or edge|prompt api|gemini|built-in ai|ai is not available|ai is turned off|setup was cancelled|download a model|webgpu|not available for categorization|not available for fsa|not available in this browser|quick one-time setup|activate built-in|enable ai|complete on-device|local structured ai/i.test(
    message,
  );
}

export const CHROME_MANUAL_COPY_ITEMS = [
  {
    label: "Prompt API for Gemini Nano (flag)",
    value: "chrome://flags/#prompt-api-for-gemini-nano",
  },
  {
    label: "On-device model (flag)",
    value: "chrome://flags/#optimization-guide-on-device-model",
  },
  {
    label: "Chrome components (Nano model)",
    value: "chrome://components",
  },
  {
    label: "WebGPU status",
    value: "chrome://gpu",
  },
] as const;
