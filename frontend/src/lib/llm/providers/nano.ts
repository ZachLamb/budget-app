/**
 * Tier 1 — Chrome/Edge built-in Gemini Nano via the Prompt API.
 *
 * Spec / docs: https://developer.chrome.com/docs/ai/built-in
 *
 * The API ships under `LanguageModel` on the global. We treat the whole thing
 * as untyped and narrow at use. Sessions are reused across calls to avoid
 * paying the warm-up cost twice.
 */

import type { GenerateOptions, LLMProvider } from "../types";

interface NanoSession {
  promptStreaming(input: string, opts?: { signal?: AbortSignal }): AsyncIterable<string>;
  destroy?: () => void;
}

interface NanoNamespace {
  availability: () => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  create: (opts?: {
    initialPrompts?: { role: "system" | "user" | "assistant"; content: string }[];
    temperature?: number;
    topK?: number;
    monitor?: (m: EventTarget) => void;
  }) => Promise<NanoSession>;
}

function nano(): NanoNamespace | null {
  const lm = (globalThis as unknown as { LanguageModel?: NanoNamespace }).LanguageModel;
  return lm ?? null;
}

let cached: NanoSession | null = null;
let cachedSystem: string | null = null;

async function ensureSession(system?: string): Promise<NanoSession> {
  // Cache invalidation: if the system prompt changes, build a fresh session.
  if (cached && cachedSystem === (system ?? null)) return cached;
  if (cached?.destroy) {
    try {
      cached.destroy();
    } catch {
      // ignore
    }
  }
  const ns = nano();
  if (!ns) throw new Error("Gemini Nano (LanguageModel) is not available in this browser.");
  const session = await ns.create({
    initialPrompts: system ? [{ role: "system", content: system }] : undefined,
    temperature: 0.3,
    topK: 3,
  });
  cached = session;
  cachedSystem = system ?? null;
  return session;
}

class NanoProvider implements LLMProvider {
  readonly name = "nano" as const;
  readonly tier = 1 as const;
  readonly privacy = "local" as const;

  async *generate(prompt: string, opts: GenerateOptions = {}): AsyncIterable<string> {
    const session = await ensureSession(opts.system);
    // The Prompt API ignores maxTokens currently; we don't pass it.
    // Cancellation is wired through AbortSignal — Chrome respects it.
    yield* session.promptStreaming(prompt, { signal: opts.signal });
  }
}

export const nanoProvider: LLMProvider = new NanoProvider();

/** Test/dev — drop the cached session (e.g., after a system prompt change). */
export function _resetNanoSession(): void {
  if (cached?.destroy) {
    try {
      cached.destroy();
    } catch {
      // ignore
    }
  }
  cached = null;
  cachedSystem = null;
}
