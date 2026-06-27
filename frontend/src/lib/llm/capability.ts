/**
 * Capability detection for the tiered LLM system.
 *
 * Probes are best-effort and don't throw — unknown features degrade to "unsupported".
 * Designed to run once on the client; result is cached in `getCapability()`.
 */

import type { CapabilitySnapshot } from "./types";

const STORAGE_FOR_3B_BYTES = 2_000_000_000; // 2 GB headroom for the 3B model + KV cache
const STORAGE_FOR_1B_BYTES = 700_000_000; // 700 MB for the Lite (1B) model

let cached: CapabilitySnapshot | null = null;
let inflight: Promise<CapabilitySnapshot> | null = null;

/** SSR-safe — returns "unsupported"/"none" for everything. */
function emptySnapshot(): CapabilitySnapshot {
  return {
    nano: { available: false, status: "unsupported" },
    webgpu: { available: false, modelSize: "none" },
    specialized: { summarizer: false, writer: false, rewriter: false, proofreader: false },
  };
}

async function probeOne(name: "Summarizer" | "Writer" | "Rewriter" | "Proofreader"): Promise<boolean> {
  const api = (globalThis as unknown as Record<string, { availability?: () => Promise<string> }>)[name];
  if (!api || typeof api.availability !== "function") return false;
  try {
    return (await api.availability()) === "available";
  } catch {
    return false;
  }
}

async function probeSpecialized(): Promise<CapabilitySnapshot["specialized"]> {
  const [summarizer, writer, rewriter, proofreader] = await Promise.all([
    probeOne("Summarizer"),
    probeOne("Writer"),
    probeOne("Rewriter"),
    probeOne("Proofreader"),
  ]);
  return { summarizer, writer, rewriter, proofreader };
}

async function probeNano(): Promise<CapabilitySnapshot["nano"]> {
  // The Prompt API is exposed as `LanguageModel` on the global in current Chrome.
  // (Older Origin Trial used `window.ai.languageModel`; we don't probe that —
  // users on those builds can update.)
  const LM = (globalThis as unknown as { LanguageModel?: { availability?: () => Promise<string> } }).LanguageModel;
  if (!LM || typeof LM.availability !== "function") {
    return { available: false, status: "unsupported" };
  }
  try {
    const status = await LM.availability();
    // Possible values: "available" | "downloadable" | "downloading" | "unavailable"
    if (status === "available") return { available: true, status: "available" };
    if (status === "downloadable") return { available: true, status: "downloadable" };
    if (status === "downloading") return { available: true, status: "downloading" };
    return { available: false, status: "unavailable" };
  } catch {
    return { available: false, status: "unsupported" };
  }
}

async function probeWebGPU(): Promise<CapabilitySnapshot["webgpu"]> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter?: (opts?: unknown) => Promise<unknown> } }).gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    return { available: false, modelSize: "none" };
  }
  let adapter: unknown = null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch {
    return { available: false, modelSize: "none" };
  }
  if (!adapter) return { available: false, modelSize: "none" };

  let storageQuotaBytes: number | undefined;
  try {
    if (navigator.storage && typeof navigator.storage.estimate === "function") {
      const est = await navigator.storage.estimate();
      // `quota - usage` is the practical headroom. `quota` alone misreports under high disk pressure.
      const free = (est.quota ?? 0) - (est.usage ?? 0);
      storageQuotaBytes = free > 0 ? free : 0;
    }
  } catch {
    // ignore — storage probe is informational
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  let modelSize: "3b" | "1b" | "none" = "none";
  if (isIOS) {
    // iOS WebGPU is memory-pressured even when limits report otherwise.
    // Force 1B regardless of headroom — 3B has been observed to OOM tabs.
    modelSize = storageQuotaBytes === undefined || storageQuotaBytes >= STORAGE_FOR_1B_BYTES ? "1b" : "none";
  } else if (storageQuotaBytes === undefined || storageQuotaBytes >= STORAGE_FOR_3B_BYTES) {
    modelSize = "3b";
  } else if (storageQuotaBytes >= STORAGE_FOR_1B_BYTES) {
    modelSize = "1b";
  }

  return { available: true, modelSize, storageQuotaBytes };
}

/** Probe the device. Cached after first call; pass `force=true` to re-probe. */
export async function getCapability(force = false): Promise<CapabilitySnapshot> {
  if (typeof window === "undefined") return emptySnapshot();
  if (cached && !force) return cached;
  if (inflight && !force) return inflight;

  inflight = (async () => {
    const [nano, webgpu, specialized] = await Promise.all([probeNano(), probeWebGPU(), probeSpecialized()]);
    const snapshot: CapabilitySnapshot = {
      nano,
      webgpu,
      specialized,
    };
    cached = snapshot;
    inflight = null;
    return snapshot;
  })();
  return inflight;
}

/** Test/dev helper — clear the memoized capability. */
export function _resetCapabilityCache(): void {
  cached = null;
  inflight = null;
}
