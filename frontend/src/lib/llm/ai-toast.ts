"use client";

import { appToast } from "@/lib/app-toast";
import { isAiAvailabilityMessage, openAiSettings } from "./ai-settings-link";

const settingsToastAction = {
  label: "Open AI settings",
  onClick: openAiSettings,
} as const;

/** Warning toast for on-device AI issues — always includes a Settings link. */
export function toastAiAvailability(
  message: string,
  options?: { description?: string; duration?: number },
): void {
  appToast.warning(message, {
    description: options?.description,
    duration: options?.duration ?? 8000,
    action: settingsToastAction,
  });
}

/** If the error looks like an AI availability problem, toast with Settings link. */
export function toastMaybeAiAvailability(context: string, error: unknown): boolean {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : context;
  const combined = `${context} ${detail}`;
  if (!isAiAvailabilityMessage(combined)) return false;
  toastAiAvailability(context, { description: detail !== context ? detail : undefined });
  return true;
}
