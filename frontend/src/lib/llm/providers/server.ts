/**
 * Tier 4 — Self-hosted cloud (Ollama in dev, Modal vLLM in prod).
 *
 * Talks to the Next.js proxy at /api/llm/cloud, which forwards to the FastAPI
 * backend. The backend gates on per-feature consent, applies per-user rate
 * limits, and audits without logging request bodies.
 *
 * Wire format: SSE events `data: {"chunk": "..."}` and a final `data: {"done": true}`.
 */

import type { GenerateOptions, LLMProvider } from "../types";
import type { FeatureId } from "../features";

interface CloudRequest {
  feature: FeatureId;
  prompt: string;
  system?: string;
  maxTokens?: number;
}

class ServerProvider implements LLMProvider {
  readonly name = "server" as const;
  readonly tier = 4 as const;
  readonly privacy = "server" as const;

  constructor(private readonly featureId: FeatureId, private readonly authToken: () => string | null) {}

  async *generate(prompt: string, opts: GenerateOptions = {}): AsyncIterable<string> {
    const token = this.authToken();
    if (!token) throw new Error("Not authenticated.");

    const body: CloudRequest = { feature: this.featureId, prompt };
    if (opts.system) body.system = opts.system;
    if (opts.maxTokens) body.maxTokens = opts.maxTokens;

    const resp = await fetch("/api/llm/cloud", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const data = await resp.json();
        if (data?.detail) detail = String(data.detail);
      } catch {
        // body wasn't JSON; keep generic detail
      }
      throw new Error(detail);
    }
    if (!resp.body) throw new Error("Empty response body.");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE messages are separated by blank lines.
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const event = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!event) continue;
          // Each event has lines like "data: <json>".
          for (const line of event.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const json = line.slice(5).trim();
            if (!json) continue;
            try {
              const parsed = JSON.parse(json) as { chunk?: string; done?: boolean; error?: string };
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.done) return;
              if (typeof parsed.chunk === "string" && parsed.chunk.length > 0) yield parsed.chunk;
            } catch (e) {
              if (e instanceof SyntaxError) continue; // ignore malformed event
              throw e;
            }
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }
  }
}

export function makeServerProvider(featureId: FeatureId, getToken: () => string | null): LLMProvider {
  return new ServerProvider(featureId, getToken);
}
