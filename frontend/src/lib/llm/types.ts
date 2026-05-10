/**
 * Shared types for the tiered LLM system.
 *
 * Tier 1 (Nano)        — Chrome built-in Gemini Nano. On-device, free, no download.
 * Tier 2 (web-llm)     — WebGPU + downloaded weights. On-device, ~700 MB / 2 GB.
 * Tier 4 (server)      — Self-hosted Ollama (dev) / Modal vLLM (prod). Opt-in only.
 *
 * Tier 3 (WASM CPU) is intentionally not implemented — too slow to ship.
 */

export type Tier = 1 | 2 | 4;

export type Privacy = "local" | "server";

export type ProviderName = "nano" | "web-llm" | "server";

export interface GenerateOptions {
  signal?: AbortSignal;
  /** Soft cap; provider may produce fewer tokens. */
  maxTokens?: number;
  /** Override the system prompt for this call. */
  system?: string;
}

export interface LLMProvider {
  readonly name: ProviderName;
  readonly tier: Tier;
  readonly privacy: Privacy;

  /**
   * Stream a completion. Yields incremental string chunks.
   * Throws if the provider becomes unavailable mid-call.
   */
  generate(prompt: string, opts?: GenerateOptions): AsyncIterable<string>;
}

/** Snapshot of what's possible on the current device/browser. */
export interface CapabilitySnapshot {
  /** Tier 1 — Chrome built-in Nano. */
  nano: { available: boolean; status: "available" | "downloadable" | "downloading" | "unavailable" | "unsupported" };
  /** Tier 2 — WebGPU available. */
  webgpu: {
    available: boolean;
    /** Suggested model size based on adapter limits + storage. */
    modelSize: "3b" | "1b" | "none";
    /** Free storage estimate in bytes (best-effort). */
    storageQuotaBytes?: number;
  };
  /** Tier 4 — server is reachable when user opts in. Always true at the network layer; consent is the gate. */
  server: { available: boolean };
}

export type ConsentDecision = "granted" | "denied" | "unset";

/** Local-only consent (e.g., model download, persistent storage). Stored in localStorage. */
export interface LocalConsent {
  /** User permitted Tier 2 model download. Implies storage usage. */
  downloadModel?: ConsentDecision;
  /** User chose 1B "Lite" instead of 3B (low storage / iOS). */
  useLiteModel?: boolean;
}
