import type { CapabilitySnapshot, LLMProvider } from "../types";

export interface PipelineProgress {
  step: string;
  label: string;
}

export interface PipelineContext {
  /** Nano in v1. */
  provider: LLMProvider;
  capability: CapabilitySnapshot;
  signal?: AbortSignal;
  onProgress?: (p: PipelineProgress) => void;
}
