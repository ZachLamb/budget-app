/**
 * Client for the cloud LLM consent + admin endpoints. The streaming generate
 * call is in `lib/llm/providers/server.ts` because it uses fetch directly
 * (axios doesn't expose `ReadableStream` well in the browser).
 */

import api from "./client";

export interface CloudConsentGrant {
  id: number;
  feature: string;
  tier: number;
  grantedAt: string;
  revokedAt: string | null;
}

export const llmApi = {
  /** All cloud consent grants for the current user (active and revoked). */
  listCloudConsent: () =>
    api.get<CloudConsentGrant[]>("/llm/consent").then((r) => r.data),

  /** Grant cloud consent for a specific feature. Idempotent. */
  grantCloudConsent: (feature: string) =>
    api.post<CloudConsentGrant>("/llm/consent", { feature, tier: 4 }).then((r) => r.data),

  /** Revoke cloud consent for a specific feature. Also purges cache for that user+feature. */
  revokeCloudConsent: (feature: string) =>
    api.delete<{ ok: true }>(`/llm/consent/${encodeURIComponent(feature)}`).then((r) => r.data),

  /** Revoke all cloud consent for the current user. Purges all cached content for them. */
  revokeAllCloudConsent: () =>
    api.delete<{ ok: true; revoked: number }>("/llm/consent").then((r) => r.data),
};
