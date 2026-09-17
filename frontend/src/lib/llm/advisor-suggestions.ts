/**
 * Route-aware starter prompts for the AI advisor panel.
 *
 * The panel is app-wide, but its starter prompts used to be one static list of
 * four, so /payees offered "How can I pay off my debt faster?" — a question
 * that has nothing to do with payees and that the page's own data cannot
 * answer. Meanwhile /transactions and /budget already deep-link into the
 * advisor with a page-specific prompt (`/?ai_open=1&ai_prompt=…`), which is the
 * pattern worth following everywhere.
 *
 * Pure so the mapping is unit-tested without rendering the panel.
 */

/** Shown on the dashboard, on Settings, and for any unmapped route. */
export const GENERAL_SUGGESTIONS = [
  "Where am I overspending this month?",
  "What should I prioritize financially?",
  "Help me create a savings plan",
] as const;

const BY_ROUTE: Record<string, readonly string[]> = {
  "/budget": [
    "How should I assign my remaining income this month?",
    "Which categories am I consistently over on?",
    "Where am I overspending this month?",
  ],
  "/transactions": [
    "Help me categorize uncategorized transactions and suggest rules for similar payees.",
    "Are there any duplicate or unusual transactions recently?",
    "What did I spend the most on this month?",
  ],
  "/accounts": [
    "Do my account balances look healthy?",
    "Which account should I pay down first?",
  ],
  "/plan": [
    "How can I pay off my debt faster?",
    "Help me create a savings plan",
    "Am I on track for my goals?",
  ],
  "/reports": [
    "What changed in my spending compared with last month?",
    "Where is my money actually going?",
  ],
  "/recurring": [
    "Which subscriptions should I consider cancelling?",
    "Have any of my recurring charges gone up?",
  ],
  "/categories": [
    "Are my categories set up sensibly for how I spend?",
    "Which categories do I not really need?",
  ],
  "/payees": [
    "Which payees do I spend the most with?",
    "Are there payees I should set up a rule for?",
  ],
  "/rules": [
    "Suggest auto-categorization rules based on my recent spending.",
    "Which of my transactions are still uncategorized?",
  ],
  "/deductions": [
    "Which of my expenses might be tax deductible?",
    "How much could I be saving on tax?",
  ],
};

/**
 * Starter prompts for a pathname. Falls back to the general set for the
 * dashboard, Settings, and anything unmapped, so a new route is never left
 * with prompts that make no sense on it.
 */
export function suggestionsForPath(pathname: string | null | undefined): readonly string[] {
  if (!pathname) return GENERAL_SUGGESTIONS;
  // Normalise a trailing slash and ignore any nested segments: /plan?tab=debt
  // arrives here as /plan, and a future /reports/spending should inherit
  // /reports' prompts rather than falling back to the general set.
  const path = pathname.replace(/\/+$/, "") || "/";
  if (BY_ROUTE[path]) return BY_ROUTE[path];
  const top = "/" + path.split("/").filter(Boolean)[0];
  return BY_ROUTE[top] ?? GENERAL_SUGGESTIONS;
}
