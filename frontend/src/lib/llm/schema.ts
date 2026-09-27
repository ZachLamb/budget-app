import type { FeatureId } from "./features";

/**
 * JSON schemas for structured features, fed to Nano via `responseConstraint`.
 * Only the structured features have one; free-text features return undefined.
 *
 * Schemas mirror the parsers in `contracts.ts` (`parseFsaStructured`,
 * `parseCategorizeSuggestions`) so Nano emits already-valid JSON.
 */
/** A figure the model may only give together with the line it read it from. */
const QUOTED_FIGURE = {
  type: ["object", "null"],
  required: ["value", "source_text"],
  additionalProperties: false,
  properties: {
    value: { type: "number" },
    source_text: { type: "string" },
  },
} as const;

const SCHEMAS: Partial<Record<FeatureId, Record<string, unknown>>> = {
  // Every figure is an object or null -- there is deliberately no way to
  // express "0 because I could not find it". The model can emit a number
  // alongside the line it was read from, or nothing at all.
  paystub_extract: {
    type: "object",
    required: ["pay_date", "gross", "gross_ytd", "federal_withheld", "federal_withheld_ytd", "state_withheld", "state_withheld_ytd", "ss_withheld", "ss_withheld_ytd", "medicare_withheld", "medicare_withheld_ytd", "pretax_401k", "pretax_401k_ytd", "pretax_hsa", "pretax_hsa_ytd"],
    additionalProperties: false,
    properties: {
      pay_date: { type: ["string", "null"] },
      gross: QUOTED_FIGURE,
      gross_ytd: QUOTED_FIGURE,
      federal_withheld: QUOTED_FIGURE,
      federal_withheld_ytd: QUOTED_FIGURE,
      state_withheld: QUOTED_FIGURE,
      state_withheld_ytd: QUOTED_FIGURE,
      ss_withheld: QUOTED_FIGURE,
      ss_withheld_ytd: QUOTED_FIGURE,
      medicare_withheld: QUOTED_FIGURE,
      medicare_withheld_ytd: QUOTED_FIGURE,
      pretax_401k: QUOTED_FIGURE,
      pretax_401k_ytd: QUOTED_FIGURE,
      pretax_hsa: QUOTED_FIGURE,
      pretax_hsa_ytd: QUOTED_FIGURE,
    },
  },
  prior_year_extract: {
    type: "object",
    required: [
      "year",
      "agi",
      "taxable_income",
      "total_tax",
      "total_withheld",
      "tax_before_credits",
    ],
    additionalProperties: false,
    properties: {
      year: { type: ["integer", "null"] },
      agi: QUOTED_FIGURE,
      taxable_income: QUOTED_FIGURE,
      total_tax: QUOTED_FIGURE,
      total_withheld: QUOTED_FIGURE,
      tax_before_credits: QUOTED_FIGURE,
    },
  },
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
