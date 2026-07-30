export type OnDeviceErrorCode =
  | "no_model"
  | "facts_unavailable"
  | "download_failed"
  | "session_create_failed"
  | "context_overflow"
  | "schema_parse_failed"
  | "verify_failed"
  | "aborted";

export class OnDeviceError extends Error {
  constructor(
    readonly code: OnDeviceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OnDeviceError";
  }
}

/**
 * Codes meaning "the model produced a bad answer", as opposed to "the engine
 * broke". Only these are worth another attempt on the same tier, or an
 * escalation to a stronger one — a session/context/download failure fails
 * identically every time, so retrying it just delays the real error.
 */
export const RETRYABLE_GENERATION_CODES: ReadonlySet<OnDeviceErrorCode> = new Set([
  "schema_parse_failed",
  "verify_failed",
]);

/** True when `e` is a bad-generation failure worth retrying or escalating. */
export function isRetryableGeneration(e: unknown): e is OnDeviceError {
  return e instanceof OnDeviceError && RETRYABLE_GENERATION_CODES.has(e.code);
}

const MESSAGES: Record<OnDeviceErrorCode, string> = {
  no_model:
    "On-device AI needs Chrome or Edge on a desktop computer. Open Settings → AI for setup steps (no app install required).",
  facts_unavailable:
    "Couldn't load your financial data to analyze. Check your connection and try again — if it keeps happening, sign out and back in.",
  download_failed: "Couldn't finish setting up on-device AI. Try again.",
  session_create_failed: "On-device AI couldn't start. Try again.",
  context_overflow:
    "There was too much to analyze at once. Try a narrower question.",
  schema_parse_failed: "The result came back malformed. Try again.",
  verify_failed:
    "We couldn't check the result against your numbers. Try again.",
  aborted: "Cancelled.",
};

import { isAiAvailabilityMessage } from "./ai-settings-link";

export function userMessageFor(e: unknown): string {
  if (e instanceof OnDeviceError) return MESSAGES[e.code];
  if (e instanceof Error) {
    if (isAiAvailabilityMessage(e.message)) return e.message;
    if (e.message.trim()) return e.message;
  }
  return "Something went wrong. Try again.";
}
