/**
 * Client-side hint for whether the user message might be a data-entry intent.
 * Skips the parse-action round-trip when false (latency); server still validates
 * everything on execute-action.
 */
export function messageMightBeActionIntent(text: string): boolean {
  const s = text.trim();
  if (s.length < 4) return false;

  if (/\d{4}-\d{2}-\d{2}/.test(s)) return true;
  if (/\d{1,2}\/\d{1,2}(\/\d{2,4})?/.test(s)) return true;
  if (/[$£€]\s*\d/.test(s)) return true;
  if (/\b\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s*(?:bucks|dollars|usd)\b/i.test(s)) return true;

  if (
    /\b(add|record|log|enter)\s+(?:(?:a|an|the)\s+)?(transaction|purchase|expense|deposit|income|payment)\b/i.test(
      s,
    )
  ) {
    return true;
  }
  if (/\b(create|add)\s+(a\s+)?(debt|loan|liability|credit\s+card\s+account)\b/i.test(s)) return true;
  if (/\b(spent|paid|bought|charged|debited|credited)\b/i.test(s)) return true;
  if (/\btransaction\b/i.test(s) && /\b(on|at|for|from)\b/i.test(s)) return true;

  return false;
}
