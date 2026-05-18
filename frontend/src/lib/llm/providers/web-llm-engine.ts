/**
 * Tier 2 — web-llm engine wrapper.
 *
 * Loaded lazily after the user accepts the download prompt. Runs the model
 * in a Web Worker so the UI thread stays responsive during inference.
 *
 * Model selection follows the capability snapshot:
 *   modelSize="3b" → Llama-3.2-3B-Instruct-q4f16_1-MLC (~1.8 GB)
 *   modelSize="1b" → Llama-3.2-1B-Instruct-q4f16_1-MLC (~700 MB, "Lite")
 *
 * web-llm caches model files in OPFS. Subsequent loads start from cache.
 */

import type { GenerateOptions, LLMProvider } from "../types";
import { getCapability } from "../capability";
import { getLocalConsent } from "../consent";
import { withEngineLockGenerator } from "../engine-busy";

const MODEL_3B = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
const MODEL_1B = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

interface MLCEngine {
  reload: (modelId: string, opts?: { chatOpts?: unknown }) => Promise<void>;
  chat: {
    completions: {
      create: (req: {
        messages: { role: "system" | "user" | "assistant"; content: string }[];
        stream: true;
        max_tokens?: number;
      }) => AsyncIterable<{ choices: { delta: { content?: string } }[] }>;
    };
  };
  resetChat: () => Promise<void>;
}

interface MLCModule {
  CreateMLCEngine: (
    modelId: string,
    opts?: {
      initProgressCallback?: (p: { progress: number; text?: string }) => void;
      logLevel?: "INFO" | "WARN" | "ERROR" | "SILENT";
    },
  ) => Promise<MLCEngine>;
}

let engine: MLCEngine | null = null;
let loading: Promise<MLCEngine> | null = null;

/** Optional progress callback wired in by callers showing download UI. */
let progressListener: ((p: { progress: number; text?: string }) => void) | null = null;

export function setWebLlmProgressListener(cb: ((p: { progress: number; text?: string }) => void) | null): void {
  progressListener = cb;
}

async function chooseModel(): Promise<string> {
  const cap = await getCapability();
  const local = getLocalConsent();
  if (local.useLiteModel) return MODEL_1B;
  if (cap.webgpu.modelSize === "1b") return MODEL_1B;
  return MODEL_3B;
}

async function ensureEngine(): Promise<MLCEngine> {
  if (engine) return engine;
  if (loading) return loading;

  loading = (async () => {
    const modelId = await chooseModel();
    // Dynamic import keeps the ~10 MB worker bundle off the critical path.
    const mod = (await import("@mlc-ai/web-llm")) as unknown as MLCModule;
    const created = await mod.CreateMLCEngine(modelId, {
      initProgressCallback: (p) => {
        try {
          progressListener?.(p);
        } catch {
          // listener errors must not abort the load
        }
      },
      logLevel: "WARN",
    });
    engine = created;
    return created;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

class WebLlmProvider implements LLMProvider {
  readonly name = "web-llm" as const;
  readonly tier = 2 as const;
  readonly privacy = "local" as const;

  async *generate(prompt: string, opts: GenerateOptions = {}): AsyncIterable<string> {
    yield* withEngineLockGenerator(async function* () {
      const eng = await ensureEngine();
      await eng.resetChat();
      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
      if (opts.system) messages.push({ role: "system", content: opts.system });
      messages.push({ role: "user", content: prompt });

      const stream = eng.chat.completions.create({
        messages,
        stream: true,
        max_tokens: opts.maxTokens,
      });

      for await (const chunk of stream) {
        if (opts.signal?.aborted) return;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    });
  }
}

export const webLlmProvider: LLMProvider = new WebLlmProvider();
