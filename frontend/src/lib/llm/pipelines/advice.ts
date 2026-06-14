import { OnDeviceError } from "../errors";
import { schemaForFeature } from "../schema";
import { withNanoSlot } from "../session-pool";
import { generateStructured, ground, verify, type Check } from "./steps";
import type { ContextFacts } from "./qa";
import type { PipelineContext } from "./types";

export interface AdviceResult {
  advice: string;
  basis: string[];
  disclaimer: string;
  /** Always true — financial advice is surfaced as a non-authoritative draft. */
  draft: true;
}

/**
 * Fixed disclaimer. The pipeline sets this, NOT the model, so it can never be
 * weakened or removed by generation.
 */
export const ADVICE_DISCLAIMER =
  "This is general information based on your data, not professional financial advice. Verify before acting.";

const MAX_RETRIES = 2;

/** Numeric tokens (with optional $, commas, decimals, leading minus). */
function numericTokens(text: string): string[] {
  const matches = text.match(/-?\$?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches.map((t) => t.replace(/[$,]/g, ""));
}

/** Every id the model may cite as a basis, drawn from the grounded context. */
function knownFactIds(facts: ContextFacts): Set<string> {
  const ids = new Set<string>();
  for (const a of facts.accounts) ids.add(a.account_id);
  for (const s of facts.recent_spend_by_category) ids.add(s.category_id);
  for (const c of facts.budget.categories) ids.add(c.category_id);
  for (const g of facts.goals) ids.add(g.goal_id);
  return ids;
}

export interface AdviceParams {
  question: string;
}

/**
 * `financial_advice` on-device pipeline — the strictest verifier per the spec's
 * risk note. ground → generate(schema) → (force disclaimer) → verify (retry).
 * Rejects advice that cites unknown facts or introduces any numeric claim not
 * present in the grounded facts. The disclaimer is always pipeline-set.
 */
export async function runAdvicePipeline(
  ctx: PipelineContext,
  params: AdviceParams,
): Promise<AdviceResult> {
  return withNanoSlot(async () => {
    ctx.onProgress?.({ step: "ground", label: "Reviewing your finances…" });
    const facts = await ground<ContextFacts>("/ai/facts/context", ctx.signal);
    const known = knownFactIds(facts);
    const factsText = JSON.stringify(facts);
    const factNumbers = new Set(numericTokens(factsText));

    const checks: Check<AdviceResult>[] = [
      (r) => r.advice.trim().length > 0,
      (r) => r.disclaimer === ADVICE_DISCLAIMER,
      (r) => r.basis.length > 0 && r.basis.every((id) => known.has(id)),
      // Every number in the advice must appear in the grounded facts.
      (r) => numericTokens(r.advice).every((n) => factNumbers.has(n)),
    ];

    const system =
      "You are a conservative financial assistant. Use ONLY the provided facts. " +
      "Do NOT state any number that is not in the facts. List the fact ids you relied on in basis.";
    const prompt =
      `Question: ${params.question}\n` +
      `Valid fact ids you may use as basis: ${[...known].join(", ")}.\n` +
      `Facts: ${factsText}`;

    ctx.onProgress?.({ step: "generate", label: "Drafting advice…" });
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      ctx.signal?.throwIfAborted?.();
      const draft = await generateStructured<Omit<AdviceResult, "draft">>(
        ctx.provider,
        {
          system,
          prompt,
          schema: schemaForFeature("financial_advice")!,
          signal: ctx.signal,
        },
      );
      // The pipeline owns the disclaimer — overwrite whatever the model emitted.
      const candidate: AdviceResult = {
        ...draft,
        disclaimer: ADVICE_DISCLAIMER,
        draft: true,
      };
      try {
        const result = verify(candidate, checks);
        ctx.onProgress?.({ step: "done", label: "Done" });
        return result;
      } catch {
        if (attempt === MAX_RETRIES) {
          throw new OnDeviceError(
            "verify_failed",
            "Could not produce grounded advice.",
          );
        }
      }
    }
    throw new OnDeviceError(
      "verify_failed",
      "Could not produce grounded advice.",
    );
  });
}
