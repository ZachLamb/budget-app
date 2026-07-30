/**
 * Tier 4 — the user's own model server (LM Studio / Ollama), reached through the
 * backend proxy.
 *
 * Exists as an `LLMProvider` so a browser with no on-device tier (Safari,
 * Firefox, mobile) can still run the pipelines when the user has opted into
 * their own server. Non-streaming: the proxy collects the SSE body and returns
 * the whole completion, so `generate` yields exactly one chunk.
 */

import type { FeatureId } from "../features";
import { maxTokensFor } from "../max-tokens";
import type { GenerateOptions, LLMProvider } from "../types";
import { streamCloudGenerate } from "./cloud";

export function createLocalServerProvider(feature: FeatureId): LLMProvider {
  return {
    name: "local-server",
    tier: 4,
    privacy: "self-hosted",
    async *generate(prompt: string, opts: GenerateOptions = {}) {
      yield await streamCloudGenerate({
        feature,
        system: opts.system ?? "",
        prompt,
        maxTokens: opts.maxTokens ?? maxTokensFor(feature),
        signal: opts.signal,
      });
    },
  };
}
