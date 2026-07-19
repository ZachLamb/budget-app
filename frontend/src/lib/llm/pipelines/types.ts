import type { CapabilitySnapshot, LLMProvider } from "../types";
import type { CascadeProviders } from "../cascade";

export interface PipelineProgress {
  step: string;
  label: string;
}

export interface PipelineContext {
  provider: LLMProvider;
  /** When set, verified pipelines may escalate to WebLLM then cloud. */
  cascade?: CascadeProviders;
  capability: CapabilitySnapshot;
  /**
   * User opted to use their self-hosted server (LM Studio / Ollama) as the
   * primary model. Verified pipelines try it first and fall back to on-device.
   */
  preferLocal?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: PipelineProgress) => void;
}
