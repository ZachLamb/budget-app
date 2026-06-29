/** Result of gating an AI feature before run — shared to avoid client-only imports. */
export type PrepareFeatureResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "unavailable"; message?: string };
