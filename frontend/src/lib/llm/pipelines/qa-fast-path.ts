import { formatCurrency } from "@/lib/format";
import type { SearchMatch } from "./qa-prompt";
import { ground } from "./steps";
import type { PipelineContext } from "./types";

interface SearchFacts {
  query_terms: string[];
  matches: SearchMatch[];
}

function formatMatchLine(m: SearchMatch): string {
  const name = m.name;
  const parts: string[] = [];
  if (m.this_month > 0) {
    parts.push(`${formatCurrency(m.this_month)} this month (${m.txn_count} txn)`);
  }
  if (m.last_month > 0) {
    parts.push(`${formatCurrency(m.last_month)} last month`);
  }
  if (m.three_month_total > 0) {
    parts.push(`${formatCurrency(m.three_month_total)} over 3 months`);
  }
  if (parts.length === 0) return `• ${name}: no recent spending found.`;
  return `• ${name}: ${parts.join("; ")}.`;
}

/**
 * Tier 0 fast path: deterministic search facts → templated answer (no LLM).
 */
export async function trySpendFastPath(
  ctx: PipelineContext,
  question: string,
): Promise<{ kind: "answer"; answer: string; cited_facts: string[] } | null> {
  try {
    const data = await ground<SearchFacts>(
      `/ai/facts/search?q=${encodeURIComponent(question.slice(0, 500))}`,
      ctx.signal,
    );
    const matches = data.matches ?? [];
    if (matches.length === 0) return null;

    const lines = matches.slice(0, 6).map(formatMatchLine);
    const terms =
      data.query_terms.length > 0
        ? `Matched your question for: ${data.query_terms.join(", ")}.`
        : "Here's what I found in your data.";

    const answer = [
      terms,
      "",
      ...lines,
      "",
      "These totals come directly from your transactions — not an estimate.",
    ].join("\n");

    return {
      kind: "answer",
      answer,
      cited_facts: matches.map((m) => m.id),
    };
  } catch {
    return null;
  }
}
