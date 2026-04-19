/** Shared UI strings for AI surfaces (align with backend `_NO_AI_MSG` meaning). */
export const AI_COPY = {
  noBackendShort:
    "No AI backend available. Start Ollama and ensure your backend points to it (see OLLAMA_MODEL).",
  disabledShort: "AI is turned off in Settings.",
  /** Short legal/educational disclaimer for AI-generated guidance (not professional advice). */
  educationalDisclaimer:
    "Educational only—not tax, legal, or investment advice. Confirm important decisions with a qualified professional.",
} as const;
