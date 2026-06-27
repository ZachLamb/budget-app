/**
 * Helpers for the on-device model download wizard (progress + user-facing errors).
 */

/** web-llm reports init progress as 0–1; our Progress bar uses 0–100. */
export function normalizeInitProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  const pct = progress <= 1 ? progress * 100 : progress;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/** Map engine/network failures to actionable copy for the setup wizard. */
export function formatWebLlmDownloadError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("webgpu") || lower.includes("no available gpu")) {
    return "WebGPU is required but not available. Use Chrome 113+ or Edge on desktop and confirm WebGPU is enabled at chrome://gpu.";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed")) {
    return "Could not download model files. Check your network and that huggingface.co is not blocked by a firewall, VPN, or extension.";
  }
  if (lower.includes("content security policy") || lower.includes("csp") || lower.includes("refused to connect")) {
    return "Download blocked by browser security policy. Hard-refresh the page; if it persists, try another browser or network.";
  }
  if (lower.includes("quota") || lower.includes("quotaexceeded") || lower.includes("storage")) {
    return "Not enough browser storage for the model. Free disk space or enable the lite model (~700 MB) on the previous step.";
  }
  if (lower.includes("out of memory") || lower.includes("oom") || lower.includes("memory")) {
    return "Not enough GPU memory for this model. Try the lite model, close other tabs, or use cloud AI.";
  }
  if (lower.includes("aborted") || lower.includes("cancel")) {
    return "Download was cancelled.";
  }

  return msg.trim() || "Model download failed. Try again or use cloud AI if available.";
}

/**
 * Map Gemini Nano setup failures to provider-neutral copy.
 *
 * Nano's model is fetched by Chrome's component updater (NOT Hugging Face) and
 * never touches WebGPU, so the web-llm guidance above is wrong here. Keep this
 * formatter free of huggingface.co, WebGPU, and "lite model" references.
 */
export function formatNanoSetupError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed") || lower.includes("network")) {
    return "Could not download the on-device model. Check your internet connection and try again.";
  }
  if (lower.includes("quota") || lower.includes("storage") || lower.includes("disk")) {
    return "Not enough disk space for the on-device model. Free up disk space and try again.";
  }

  return message.trim() || "On-device AI setup failed. Try again.";
}
