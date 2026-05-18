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
export {
  chooseModelId,
  clearModelFromCache,
  getModelDownloadStatus,
  MODEL_1B,
  MODEL_3B,
} from "./storage";
export type { ModelDownloadStatus } from "./storage";
export { decide } from "./router";
export type { Decision, RouterContext } from "./router";
export { nanoProvider } from "./providers/nano";
export { getWebLlmProvider } from "./providers/web-llm";
export { makeServerProvider, LLMError, isLLMError } from "./providers/server";
export { scanPrompt } from "./pii-detect";
export type { PIIFlag, PIIScan } from "./pii-detect";
export {
  parseJsonResponse,
  parseFsaStructured,
  parseCategorizeSuggestions,
  demoStructuredResult,
  StructuredParseError,
} from "./contracts";
export type {
  FsaCandidatesResponse,
  FsaCandidateRow,
  FsaStructuredResult,
  CategorizeCandidatesResponse,
  CategorizeSuggestion,
} from "./contracts";
export { runStructuredJson, runBatchedStructuredJson, fsaBatchConfig } from "./run-structured";
