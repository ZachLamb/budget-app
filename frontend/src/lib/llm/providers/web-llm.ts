/**
 * Tier 2 — WebGPU-accelerated local model via @mlc-ai/web-llm.
 *
 * Phase 2 wires the real engine in a Web Worker. This module exposes the
 * lazy loader that the router uses; the actual engine is loaded only after
 * the user has accepted the storage download prompt.
 */

import type { LLMProvider } from "../types";

/** Lazily load the worker module so its bundle isn't on the critical path. */
let loader: Promise<LLMProvider> | null = null;

export async function getWebLlmProvider(): Promise<LLMProvider> {
  if (!loader) {
    loader = (async () => {
      const mod = await import("./web-llm-engine");
      return mod.webLlmProvider;
    })();
  }
  return loader;
}

/** Stub used when web-llm hasn't been loaded yet. Throws if generate is called directly. */
export const webLlmStubProvider: LLMProvider = {
  name: "web-llm",
  tier: 2,
  privacy: "local",
  generate(): AsyncIterable<string> {
    throw new Error("web-llm provider not loaded — go through getWebLlmProvider().");
  },
};
