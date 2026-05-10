/**
 * Tier 2 (web-llm) on-device storage helpers.
 *
 * Wraps `@mlc-ai/web-llm`'s `hasModelInCache` / `deleteModelAllInfoInCache`
 * so the settings card can:
 *   - report the actual download status (not just the consent decision), and
 *   - free the cached weights when the user wants the disk space back.
 *
 * The web-llm import is dynamic — keeps the ~10 MB worker bundle off the
 * critical path. SSR-safe (no-ops when `window` is missing).
 */

import { getCapability } from "./capability";
import { getLocalConsent } from "./consent";

/** Match the engine's model selection. Kept in sync manually with web-llm-engine.ts. */
export const MODEL_3B = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
export const MODEL_1B = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

const SIZE_LABEL_3B = "~1.8 GB";
const SIZE_LABEL_1B = "~700 MB";

export type ModelDownloadStatus =
  | { kind: "unsupported" }
  | { kind: "not-downloaded"; modelId: string; sizeLabel: string }
  | { kind: "downloaded"; modelId: string; sizeLabel: string };

let cached: ModelDownloadStatus | null = null;
let inflight: Promise<ModelDownloadStatus> | null = null;

/** Pick the same model id the engine would load. Re-implemented here so we don't
 *  pull in the worker bundle just to ask "is the cache populated?" */
export async function chooseModelId(): Promise<string | null> {
  const cap = await getCapability();
  if (!cap.webgpu.available || cap.webgpu.modelSize === "none") return null;
  const local = getLocalConsent();
  if (local.useLiteModel) return MODEL_1B;
  return cap.webgpu.modelSize === "1b" ? MODEL_1B : MODEL_3B;
}

function sizeLabelFor(modelId: string): string {
  return modelId === MODEL_1B ? SIZE_LABEL_1B : SIZE_LABEL_3B;
}

/**
 * Resolve the on-device model's actual presence in OPFS / IndexedDB.
 *
 * Result is memoized for the session — callers should pass `force=true` after
 * a download completes or the cache is cleared. SSR returns `{ kind: "unsupported" }`.
 */
export async function getModelDownloadStatus(force = false): Promise<ModelDownloadStatus> {
  if (typeof window === "undefined") return { kind: "unsupported" };
  if (cached && !force) return cached;
  if (inflight && !force) return inflight;

  inflight = (async () => {
    const modelId = await chooseModelId();
    if (!modelId) {
      const result: ModelDownloadStatus = { kind: "unsupported" };
      cached = result;
      return result;
    }
    let downloaded = false;
    try {
      const mod = await import("@mlc-ai/web-llm");
      downloaded = await mod.hasModelInCache(modelId);
    } catch {
      // hasModelInCache throws if the model id is missing from prebuiltAppConfig,
      // and the underlying cache calls can throw on engines without OPFS/IDB.
      // Either way: we can't confirm presence — treat as not-downloaded.
      downloaded = false;
    }
    const sizeLabel = sizeLabelFor(modelId);
    const result: ModelDownloadStatus = downloaded
      ? { kind: "downloaded", modelId, sizeLabel }
      : { kind: "not-downloaded", modelId, sizeLabel };
    cached = result;
    return result;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Delete the cached weights, tokenizer, wasm, and chat config for the
 * currently-selected model. Resolves even if nothing was cached (idempotent).
 *
 * Throws if the dynamic web-llm import fails — caller should toast and recover.
 */
export async function clearModelFromCache(): Promise<void> {
  if (typeof window === "undefined") return;
  const modelId = await chooseModelId();
  if (!modelId) return;
  const mod = await import("@mlc-ai/web-llm");
  await mod.deleteModelAllInfoInCache(modelId);
  // Force re-probe on next status check.
  cached = null;
  inflight = null;
}

/** Test helper — clear the memoized status. */
export function _resetModelStatusCache(): void {
  cached = null;
  inflight = null;
}
