import type { FeatureId } from "./features";

/**
 * JSON schemas for structured features, fed to Nano via `responseConstraint`.
 * Only the structured features have one; free-text features return undefined.
 *
 * Schemas mirror the parsers in `contracts.ts` (`parseFsaStructured`,
 * `parseCategorizeSuggestions`) so Nano emits already-valid JSON.
 */
const SCHEMAS: Partial<Record<FeatureId, Record<string, unknown>>> = {
  fsa_review: {
    type: "object",
    required: ["eligible"],
    additionalProperties: false,
    properties: {
      eligible: {
        type: "array",
        items: {
          type: "object",
          required: ["index", "confidence", "fsa_category", "reason"],
          additionalProperties: false,
          properties: {
            index: { type: "integer" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            fsa_category: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
  },
  // NOTE: root is a JSON array (matching `parseCategorizeSuggestions`). Some
  // Chrome `responseConstraint` engines may not accept an array root and can
  // reject it at generation time; `run-structured.ts` falls back to
  // schema-less (free-text) generation in that case.
  categorize_transaction: {
    type: "array",
    items: {
      type: "object",
      required: ["transaction_id", "category_id"],
      additionalProperties: false,
      properties: {
        transaction_id: { type: "string" },
        category_id: { type: "string" },
      },
    },
  },
  budget_recommendations: {
    type: "object",
    required: ["recommendations"],
    additionalProperties: false,
    properties: {
      recommendations: {
        type: "array",
        items: {
          type: "object",
          required: ["category_id", "suggested_amount", "rationale"],
          additionalProperties: false,
          properties: {
            category_id: { type: "string" },
            suggested_amount: { type: "number" },
            rationale: { type: "string" },
          },
        },
      },
    },
  },
  goal_planning: {
    type: "object",
    required: ["plan"],
    additionalProperties: false,
    properties: {
      plan: {
        type: "object",
        required: ["goal_id", "monthly_contribution", "months_to_target", "note"],
        additionalProperties: false,
        properties: {
          goal_id: { type: "string" },
          monthly_contribution: { type: "number" },
          months_to_target: { type: "integer" },
          note: { type: "string" },
        },
      },
    },
  },
  free_form_qa: {
    type: "object",
    required: ["answer", "cited_facts"],
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      cited_facts: { type: "array", items: { type: "string" } },
    },
  },
  financial_advice: {
    type: "object",
    required: ["advice", "basis", "disclaimer"],
    additionalProperties: false,
    properties: {
      advice: { type: "string" },
      basis: { type: "array", items: { type: "string" } },
      disclaimer: { type: "string" },
    },
  },
  debt_rate_suggestions: {
    type: "object",
    required: ["suggestions"],
    additionalProperties: false,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          required: ["account_id", "suggested_apr", "suggested_min_payment", "reasoning"],
          additionalProperties: false,
          properties: {
            account_id: { type: "string" },
            suggested_apr: { type: "number" },
            suggested_min_payment: { type: "number" },
            reasoning: { type: "string" },
          },
        },
      },
    },
  },
};

export function schemaForFeature(feature: FeatureId): Record<string, unknown> | undefined {
  return SCHEMAS[feature];
}
