/**
 * Tier 4 — opt-in self-hosted cloud (Ollama on the backend). Requires per-feature
 * consent granted via POST /api/llm/consent.
 */

import type { FeatureId } from "../features";
import api from "@/lib/api/client";

export interface CloudGenerateParams {
  feature: FeatureId;
  system: string;
  prompt: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface ConsentRow {
  feature: string;
  tier: number;
  revokedAt: string | null;
  expiresAt: string | null;
}

let consentCache: { at: number; features: Set<string> } | null = null;
const CONSENT_TTL_MS = 60_000;

async function loadCloudConsents(): Promise<Set<string>> {
  const now = Date.now();
  if (consentCache && now - consentCache.at < CONSENT_TTL_MS) {
    return consentCache.features;
  }
  try {
    const r = await api.get<ConsentRow[]>("/llm/consent");
    const active = new Set<string>();
    for (const row of r.data) {
      if (row.tier !== 4) continue;
      if (row.revokedAt) continue;
      if (row.expiresAt && new Date(row.expiresAt).getTime() < now) continue;
      active.add(row.feature);
    }
    consentCache = { at: now, features: active };
    return active;
  } catch {
    return new Set();
  }
}

export async function hasCloudConsent(feature: FeatureId): Promise<boolean> {
  const features = await loadCloudConsents();
  return features.has(feature);
}

/** Non-streaming collect of SSE chunks from the cloud proxy. */
export async function streamCloudGenerate(params: CloudGenerateParams): Promise<string> {
  const res = await fetch("/api/llm/cloud", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal: params.signal,
    body: JSON.stringify({
      feature: params.feature,
      system: params.system,
      prompt: params.prompt,
      max_tokens: params.maxTokens ?? 1024,
    }),
  });

  if (!res.ok) {
    let detail = "Cloud AI is unavailable.";
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  const text = await res.text();
  let out = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const j = JSON.parse(payload) as { content?: string; error?: string };
      if (j.error) throw new Error(j.error);
      if (j.content) out += j.content;
    } catch (e) {
      if (e instanceof Error && e.message !== "Unexpected end of JSON input") throw e;
    }
  }
  if (!out.trim()) {
    throw new Error("Cloud model returned an empty response.");
  }
  return out.trim();
}
