/**
 * Public API for the tiered LLM system.
 *
 * Most callers should use the `useLlm` hook (in `./useLlm`) rather than calling
 * `decide()` directly — the hook wires React Query, auth, and consent state.
 */

export type { Tier, Privacy, LLMProvider, GenerateOptions, CapabilitySnapshot, ConsentDecision, LocalConsent, ProviderName } from "./types";
export type { FeatureId, FeaturePolicy } from "./features";
export { listFeatures, getFeaturePolicy } from "./features";
export { getCapability } from "./capability";
export { getLocalConsent, setDownloadModel, setUseLiteModel, clearLocalConsent } from "./consent";
export { decide } from "./router";
export type { Decision, RouterContext } from "./router";
export { nanoProvider } from "./providers/nano";
export { getWebLlmProvider } from "./providers/web-llm";
export { makeServerProvider } from "./providers/server";
