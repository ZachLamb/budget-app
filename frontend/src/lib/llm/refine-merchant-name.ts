/**
 * Guardrail for on-device merchant-name refinement.
 *
 * The model's job is only to *clean up* a raw bank descriptor (drop POS noise,
 * fix casing) into a nicer display / rule-match name — never to invent one.
 * Because model output is untrusted, we accept a proposal only if it is
 * demonstrably derived from the source text: every word in the proposal must
 * appear in the source, and it can't be longer than the source. Anything that
 * fails falls back to the deterministic value, so a hallucination can never
 * become a rule or a payee name.
 *
 * Pure and unit-tested — the safety of the refinement lives here, independent
 * of any model.
 */

const ALNUM = /[a-z0-9]+/gi;

/**
 * Return the cleaned name if it is a safe refinement of `sourceText`, else null.
 * `sourceText` may be one descriptor (rule match value) or several member names
 * joined together (a duplicate cluster).
 */
export function acceptRefinedName(sourceText: string, proposed: string): string | null {
  const clean = proposed.trim();
  if (!clean) return null;
  // Must contain a letter — reject pure punctuation/number noise.
  if (!/[a-z]/i.test(clean)) return null;
  // A refinement extracts/re-cases; it never grows longer than the source.
  if (clean.length > sourceText.length) return null;

  const haystack = sourceText.toLowerCase();
  const tokens = clean.toLowerCase().match(ALNUM) ?? [];
  if (tokens.length === 0) return null;
  for (const token of tokens) {
    if (!haystack.includes(token)) return null;
  }
  return clean;
}

/**
 * Apply model output (a list of `{ id, name }`) to a set of items, keeping the
 * deterministic value whenever the proposal fails the guardrail or is missing.
 * Returns a map of id → accepted refined name (only the ones that changed).
 */
export function collectAcceptedRefinements(
  items: { id: string; sourceText: string; current: string }[],
  modelOutput: unknown,
): Record<string, string> {
  const proposals = new Map<string, string>();
  if (Array.isArray(modelOutput)) {
    for (const row of modelOutput) {
      if (
        row &&
        typeof row === "object" &&
        typeof (row as { id?: unknown }).id === "string" &&
        typeof (row as { name?: unknown }).name === "string"
      ) {
        proposals.set((row as { id: string }).id, (row as { name: string }).name);
      }
    }
  }

  const accepted: Record<string, string> = {};
  for (const item of items) {
    const proposal = proposals.get(item.id);
    if (proposal === undefined) continue;
    const safe = acceptRefinedName(item.sourceText, proposal);
    if (safe && safe !== item.current) accepted[item.id] = safe;
  }
  return accepted;
}
