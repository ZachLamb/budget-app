/**
 * Tier 1 — Chrome/Edge built-in Gemini Nano via the Prompt API (`LanguageModel`).
 *
 * Sessions are reused across calls to avoid paying warm-up twice. Download is
 * only ever triggered from an explicit user gesture (see router needs_nano_setup).
 */

import type { GenerateOptions, LLMProvider, NanoSetupState } from "../types";

interface NanoSession {
  promptStreaming(
    input: string,
    opts?: { signal?: AbortSignal; responseConstraint?: Record<string, unknown>; omitResponseConstraintInput?: boolean },
  ): AsyncIterable<string>;
  destroy?: () => void;
}

interface CreateOpts {
  initialPrompts?: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  topK?: number;
  monitor?: (m: EventTarget) => void;
}

interface NanoNamespace {
  availability: () => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  create: (opts?: CreateOpts) => Promise<NanoSession>;
}

function nano(): NanoNamespace | null {
  const lm = (globalThis as unknown as { LanguageModel?: NanoNamespace }).LanguageModel;
  return lm ?? null;
}

let cached: NanoSession | null = null;
let cachedKey: string | null = null;
// In-flight de-dup: concurrent calls for the same key await one `create`.
let inflight: Promise<NanoSession> | null = null;
let inflightKey: string | null = null;

function sessionKey(system: string | undefined, temperature: number, topK: number): string {
  return `${system ?? ""}::${temperature}::${topK}`;
}

async function ensureSession(opts: GenerateOptions, monitor?: (p: number) => void): Promise<NanoSession> {
  const temperature = opts.temperature ?? 0.3;
  const topK = opts.topK ?? 3;
  const key = sessionKey(opts.system, temperature, topK);
  if (cached && cachedKey === key) return cached;
  // A creation for this exact key is already running — await it instead of
  // starting a second `create` that would orphan one of the sessions.
  if (inflight && inflightKey === key) return inflight;
  if (cached?.destroy) {
    try {
      cached.destroy();
    } catch {
      // ignore
    }
  }
  const ns = nano();
  if (!ns) throw new Error("Gemini Nano (LanguageModel) is not available in this browser.");
  inflightKey = key;
  inflight = (async () => {
    const session = await ns.create({
      initialPrompts: opts.system ? [{ role: "system", content: opts.system }] : undefined,
      temperature,
      topK,
      monitor: monitor
        ? (m: EventTarget) => {
            m.addEventListener("downloadprogress", (e: Event) => {
              // Chrome reports `loaded` as a 0–1 fraction of the download.
              const loaded = (e as Event & { loaded?: number }).loaded;
              if (typeof loaded === "number") monitor(loaded);
            });
          }
        : undefined,
    });
    cached = session;
    cachedKey = key;
    return session;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
    inflightKey = null;
  }
}

class NanoProvider implements LLMProvider {
  readonly name = "nano" as const;
  readonly tier = 1 as const;
  readonly privacy = "local" as const;

  /**
   * Await model readiness, wiring the download `monitor` for progress.
   * MUST be called from a user gesture (download requires user activation).
   */
  async ensureReady(onProgress?: (progress: number) => void): Promise<NanoSetupState> {
    try {
      await ensureSession({}, onProgress);
      return { kind: "ready" };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : "Setup failed." };
    }
  }

  async *generate(prompt: string, opts: GenerateOptions = {}): AsyncIterable<string> {
    const session = await ensureSession(opts);
    yield* session.promptStreaming(prompt, {
      signal: opts.signal,
      responseConstraint: opts.schema,
      omitResponseConstraintInput: opts.schema ? true : undefined,
    });
  }
}

export const nanoProvider: LLMProvider & {
  ensureReady(onProgress?: (progress: number) => void): Promise<NanoSetupState>;
} = new NanoProvider();

export function _resetNanoForTest(): void {
  cached = null;
  cachedKey = null;
  inflight = null;
  inflightKey = null;
}
