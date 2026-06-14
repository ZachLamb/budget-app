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
};

export function schemaForFeature(feature: FeatureId): Record<string, unknown> | undefined {
  return SCHEMAS[feature];
}
