export const INTENT_SCHEMA = {
  type: "object",
  required: ["action_type", "confirmation_text"],
  properties: {
    action_type: {
      type: "string",
      enum: ["none", "add_transaction", "add_debt", "create_category", "bulk_recategorize"],
    },
    name: { type: "string" },
    group_name: { type: "string" },
    payee_match: { type: "string" },
    category_name: { type: "string" },
    account_name: { type: "string" },
    payee_name: { type: "string" },
    amount: { type: "number" },
    date: { type: "string" },
    memo: { type: "string" },
    confirmation_text: { type: "string" },
  },
  additionalProperties: false,
} as const;

export function buildIntentSystem(): string {
  return (
    "Extract a single financial action from the user's message, if any. " +
    "Never invent field values — only copy what the user stated or implied clearly. " +
    "Use action_type 'none' for questions, summaries, or unsupported requests."
  );
}

export function buildIntentPrompt(question: string): string {
  return `User message: ${question}`;
}
