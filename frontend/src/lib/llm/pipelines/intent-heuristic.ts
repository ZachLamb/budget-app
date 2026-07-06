/**
 * Regex/heuristic intent detection — avoids a Nano call for obvious actions.
 */

import type { DetectedIntent } from "./intent";

/** Planning/advice phrasing — not imperative action commands. */
const ADVISORY_PHRASING =
  /\b(should\s+i|would\s+it|would\s+i|recommend|what\s+if|is\s+it\s+wise|can\s+i\s+afford|could\s+i)\b/i;

const ACTION_PATTERNS: {
  action_type: string;
  patterns: RegExp[];
  extract: (q: string) => Record<string, unknown>;
}[] = [
  {
    action_type: "add_transaction",
    patterns: [
      /\badd\s+(?:a\s+)?(?:\$)?([\d,.]+)\s+(?:dollar\s+)?(?:transaction|charge|expense)\s+(?:for|at)\s+(.+)/i,
      /\badd\s+(?:a\s+)?(?:\$)?([\d,.]+)\s+(?:for|at)\s+(.+)/i,
      /\brecord\s+(?:a\s+)?(?:\$)?([\d,.]+)\s+.+?\b(?:at|from|for)\s+(.+)/i,
    ],
    extract: (q) => {
      const m =
        q.match(
          /\badd\s+(?:a\s+)?(?:\$)?([\d,.]+)\s+(?:dollar\s+)?(?:transaction|charge|expense)\s+(?:for|at)\s+(.+)/i,
        ) ??
        q.match(/\badd\s+(?:a\s+)?(?:\$)?([\d,.]+)\s+(?:for|at)\s+(.+)/i) ??
        q.match(/\brecord\s+(?:a\s+)?(?:\$)?([\d,.]+)\s+.+?\b(?:at|from|for)\s+(.+)/i);
      if (!m) return {};
      const amount = parseFloat(m[1]!.replace(/,/g, ""));
      const payee = m[2]!.trim().replace(/[.?!]+$/, "");
      const out: Record<string, unknown> = {};
      if (!Number.isNaN(amount)) out.amount = amount;
      if (payee) out.payee_name = payee;
      return out;
    },
  },
  {
    action_type: "create_category",
    patterns: [/\bcreate\s+(?:a\s+)?(?:new\s+)?categor(?:y|ies)\s+(?:called|named)?\s*["']?([^"'.?!]+)/i],
    extract: (q) => {
      const m = q.match(
        /\bcreate\s+(?:a\s+)?(?:new\s+)?categor(?:y|ies)\s+(?:called|named)?\s*["']?([^"'.?!]+)/i,
      );
      return m ? { name: m[1]!.trim() } : {};
    },
  },
  {
    action_type: "bulk_recategorize",
    patterns: [
      /\b(?:recategorize|re-categorize|change\s+categor(?:y|ies)\s+for)\s+.+\bto\b/i,
      /\bmove\s+(?:all\s+)?(?:transactions?\s+)?(?:from|at)\s+.+\bto\s+(?:the\s+)?/i,
    ],
    extract: (q) => {
      const m = q.match(
        /\b(?:recategorize|re-categorize)\s+(?:transactions?\s+)?(?:from|at|for)\s+(.+?)\s+to\s+(.+?)(?:[.?!]|$)/i,
      );
      if (!m) return {};
      return { payee_match: m[1]!.trim(), category_name: m[2]!.trim() };
    },
  },
];

/** Returns an intent when the message clearly requests a supported action. */
export function tryHeuristicIntent(question: string): DetectedIntent | null {
  const q = question.trim();
  if (q.length < 8) return null;
  if (ADVISORY_PHRASING.test(q)) return null;

  for (const spec of ACTION_PATTERNS) {
    if (!spec.patterns.some((p) => p.test(q))) continue;
    const data = spec.extract(q);
    if (Object.keys(data).length === 0) continue;
    return {
      action_type: spec.action_type,
      data,
      confirmation_text: `Proceed with ${spec.action_type.replace(/_/g, " ")}?`,
    };
  }
  return null;
}

/** Spend/sum questions answerable from search facts alone (Tier 0). */
const SPEND_QUESTION =
  /\b(how\s+much|what\s+did\s+i\s+spend|total\s+(?:spend|spent)|spending\s+on|spent\s+on)\b/i;

export function isSpendLookupQuestion(question: string): boolean {
  const q = question.trim();
  if (q.length < 10) return false;
  if (/\b(add|create|delete|transfer|categorize)\b/i.test(q)) return false;
  return SPEND_QUESTION.test(q);
}
