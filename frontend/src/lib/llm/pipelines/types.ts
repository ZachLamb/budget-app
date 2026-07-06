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
  signal?: AbortSignal;
  onProgress?: (p: PipelineProgress) => void;
}
