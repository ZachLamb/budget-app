/**
 * Wave 0 contracts for local structured LLM features.
 *
 * Decisions (do not change without updating this header):
 * - Tier policy: `defaultTier: 1` for all features (see features.ts).
 * - Demo mode: client canned JSON via `isDemoMode` in run-structured (no provider calls).
 * - PWA: Next.js `app/manifest.ts` + minimal hand-rolled service worker (no Serwist).
 */

import type { FeatureId } from "./features";

export type FsaConfidence = "high" | "medium" | "low";

export interface FsaCandidateRow {
  transaction_id: string;
  date: string;
  payee_name: string;
  category_name: string | null;
  amount: number;
  notes: string | null;
  /** Persisted claim/dismiss from fsa_review_items, if any. */
  status?: "pending" | "claimed" | "dismissed";
}

export interface FsaCandidatesResponse {
  candidates: FsaCandidateRow[];
  scan_count: number;
  candidate_count: number;
  prefilter_skipped_count: number;
}

export interface FsaEligibleItem {
  index: number;
  confidence: FsaConfidence;
  fsa_category: string;
  reason: string;
}

export interface FsaStructuredResult {
  eligible: FsaEligibleItem[];
}

export interface CategorizeCandidateTransaction {
  id: string;
  payee: string;
  amount: string;
  date: string;
  notes: string | null;
}

export interface CategorizeCandidateCategory {
  id: string;
  name: string;
}

export interface CategorizeCandidatesResponse {
  transactions: CategorizeCandidateTransaction[];
  categories: CategorizeCandidateCategory[];
}

export interface CategorizeSuggestion {
  transaction_id: string;
  category_id: string;
}

export class StructuredParseError extends Error {
  constructor(
    message: string,
    readonly feature: FeatureId,
    readonly raw?: string,
  ) {
    super(message);
    this.name = "StructuredParseError";
  }
}

/** Strip markdown fences and parse JSON object/array from model text. */
export function parseJsonResponse(text: string): unknown {
  let t = text.trim();
  if (t.startsWith("```")) {
    const lines = t.split("\n");
    lines.shift();
    if (lines.at(-1)?.trim() === "```") lines.pop();
    t = lines.join("\n").trim();
  }
  return JSON.parse(t);
}

export function parseFsaStructured(raw: unknown): FsaStructuredResult {
  if (!raw || typeof raw !== "object" || !("eligible" in raw)) {
    throw new StructuredParseError("FSA response must be an object with eligible array", "fsa_review");
  }
  const eligible = (raw as { eligible: unknown }).eligible;
  if (!Array.isArray(eligible)) {
    throw new StructuredParseError("FSA eligible must be an array", "fsa_review");
  }
  const out: FsaEligibleItem[] = [];
  for (const item of eligible) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const index = Number(o.index);
    if (!Number.isFinite(index) || index < 0) continue;
    let confidence = String(o.confidence ?? "low");
    if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
      confidence = "low";
    }
    out.push({
      index,
      confidence: confidence as FsaConfidence,
      fsa_category: String(o.fsa_category ?? "Other Medical").slice(0, 50),
      reason: String(o.reason ?? "").slice(0, 200),
    });
  }
  return { eligible: out };
}

export function parseCategorizeSuggestions(raw: unknown): CategorizeSuggestion[] {
  const arr = Array.isArray(raw) ? raw : null;
  if (!arr) {
    throw new StructuredParseError(
      "Categorize response must be a JSON array",
      "categorize_transaction",
    );
  }
  const out: CategorizeSuggestion[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const transaction_id = o.transaction_id;
    const category_id = o.category_id;
    if (typeof transaction_id === "string" && typeof category_id === "string") {
      out.push({ transaction_id, category_id });
    }
  }
  return out;
}

/**
 * Demo canned responses — mirror server demo stubs and each pipeline's result
 * shape so demo mode renders without a model. The advice disclaimer text is
 * inlined (not imported from pipelines) to keep this low-level module
 * dependency-free.
 */
export function demoStructuredResult(feature: FeatureId): unknown {
  switch (feature) {
    case "fsa_review":
      return { eligible: [] };
    case "categorize_transaction":
      return [];
    case "budget_recommendations":
      return {
        recommendations: [
          {
            category_id: "demo-dining",
            suggested_amount: 300,
            rationale: "Trim dining by about $50 to get back on track.",
          },
        ],
      };
    case "goal_planning":
      return {
        plan: {
          goal_id: "demo-goal",
          monthly_contribution: 400,
          months_to_target: 12,
          note: "Keep contributing $400/month to stay on pace.",
        },
      };
    case "free_form_qa":
      return {
        kind: "answer",
        answer: "In demo mode, your spending looks on track this month.",
        cited_facts: [],
      };
    case "financial_advice":
      return {
        advice: "In demo mode, consider keeping a small buffer in checking.",
        basis: [],
        disclaimer:
          "This is general information based on your data, not professional financial advice. Verify before acting.",
        draft: true,
      };
    case "debt_rate_suggestions":
      return {
        suggestions: [
          {
            account_id: "demo-card",
            suggested_apr: 0.2299,
            suggested_min_payment: 35,
            reasoning: "Typical store-card APR; verify on your statement.",
          },
        ],
      };
    default:
      return {};
  }
}

/**
 * Demo canned text for streaming features. `llm.run` / `runStream` do not
 * consult `demoStructuredResult`, so streaming features need their own demo
 * source. Returns a few chunks so the UI streams in demo mode.
 */
export function demoStreamText(feature: FeatureId): string[] {
  switch (feature) {
    case "spending_summary":
      return ["In demo mode, ", "dining is up a bit while ", "groceries held steady."];
    case "anomaly_explanation":
      return ["In demo mode, ", "this charge is well above ", "your usual for this category."];
    default:
      return ["In demo mode, no AI summary is available for this feature."];
  }
}
