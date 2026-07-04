export interface SearchMatch {
  kind: string;
  id: string;
  name: string;
  this_month: number;
  last_month: number;
  three_month_total: number;
  txn_count: number;
}

export function buildQaSystem(): string {
  return (
    "You answer questions about the user's finances using ONLY the provided facts. " +
    "Every dollar amount in your answer must be copied verbatim from the facts — " +
    "never invent, estimate, or compute new numbers. " +
    "Cite the fact ids you used in cited_facts. Never invent ids."
  );
}

export function renderSearchMatches(matches: SearchMatch[]): string {
  return matches
    .map(
      (m) =>
        `${m.kind} "${m.name}" (id ${m.id}): this month $${m.this_month.toFixed(2)} ` +
        `across ${m.txn_count} transactions, last month $${m.last_month.toFixed(2)}, ` +
        `3-month total $${m.three_month_total.toFixed(2)}`,
    )
    .join("\n");
}

export function buildQaPrompt(
  question: string,
  knownIds: string[],
  factsText: string,
  matches: SearchMatch[],
): string {
  const matchBlock =
    matches.length > 0
      ? `\nMatching records for this question (exact, pre-computed sums):\n${renderSearchMatches(matches)}\n`
      : "";
  return (
    `Question: ${question}\n` +
    `Valid fact ids you may cite: ${knownIds.join(", ")}.\n` +
    matchBlock +
    `Facts: ${factsText}`
  );
}
