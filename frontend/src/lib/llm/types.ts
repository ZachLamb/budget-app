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
  /** Soft cap; provider may produce fewer tokens. (No-op on Nano.) */
  maxTokens?: number;
  /** Override the system prompt for this call. */
  system?: string;
  /** JSON schema for structured output (Nano `responseConstraint`). */
  schema?: Record<string, unknown>;
  /** Sampling temperature for this call (raise only for sampling steps). */
  temperature?: number;
  /** Top-K for this call; set together with temperature. */
  topK?: number;
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
  /**
   * Specialized on-device Chrome AI APIs. All optional — a false flag just
   * means a pipeline step uses the Prompt API instead. Never blocks a feature.
   */
  specialized: {
    summarizer: boolean;
    writer: boolean;
    rewriter: boolean;
    proofreader: boolean;
  };
}

export type ConsentDecision = "granted" | "denied" | "unset";

/** Local-only consent (e.g., model download, persistent storage). Stored in localStorage. */
export interface LocalConsent {
  /** User permitted Tier 2 model download. Implies storage usage. */
  downloadModel?: ConsentDecision;
  /** User chose 1B "Lite" instead of 3B (low storage / iOS). */
  useLiteModel?: boolean;
}

export type NanoSetupState =
  | { kind: "ready" }
  | { kind: "downloading"; progress: number }
  | { kind: "error"; message: string };
