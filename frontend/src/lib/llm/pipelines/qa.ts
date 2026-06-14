import { OnDeviceError } from "../errors";
import { schemaForFeature } from "../schema";
import { withNanoSlot } from "../session-pool";
import { summarize } from "../specialized";
import { generateStructured, ground, verify, type Check } from "./steps";
import type { PipelineContext } from "./types";

export interface ContextFacts {
  net_worth: number;
  accounts: { account_id: string; name: string; balance: number }[];
  recent_spend_by_category: {
    category_id: string;
    name: string;
    amount: number;
  }[];
  budget: {
    month: string;
    categories: {
      category_id: string;
      name: string;
      budgeted: number;
      actual: number;
      remaining: number;
    }[];
    total_budgeted: number;
    total_actual: number;
  };
  goals: { goal_id: string; name: string }[];
}

export interface QaResult {
  answer: string;
  cited_facts: string[];
}

export interface QaParams {
  question: string;
}

const MAX_RETRIES = 2;
const ANSWER_CAP = 1500;
/** Condense the grounded context first when its serialization is large. */
const CONDENSE_THRESHOLD = 4000;

/** Every id the model is allowed to cite, drawn from the grounded context. */
function knownFactIds(facts: ContextFacts): Set<string> {
  const ids = new Set<string>();
  for (const a of facts.accounts) ids.add(a.account_id);
  for (const s of facts.recent_spend_by_category) ids.add(s.category_id);
  for (const c of facts.budget.categories) ids.add(c.category_id);
  for (const g of facts.goals) ids.add(g.goal_id);
  return ids;
}

/**
 * `free_form_qa` on-device pipeline:
 * ground → (optional summarize) → generate(schema) → verify (retry).
 * The verifier caps answer length and rejects citations that don't correspond
 * to a real fact id in the grounded context (no hallucinated sources).
 */
export async function runQaPipeline(
  ctx: PipelineContext,
  params: QaParams,
): Promise<QaResult> {
  return withNanoSlot(async () => {
    ctx.onProgress?.({ step: "ground", label: "Gathering your data…" });
    const facts = await ground<ContextFacts>("/ai/facts/context", ctx.signal);
    const known = knownFactIds(facts);

    let factsText = JSON.stringify(facts);
    if (factsText.length > CONDENSE_THRESHOLD) {
      ctx.onProgress?.({ step: "condense", label: "Condensing context…" });
      factsText = await summarize(ctx.provider, factsText, {
        signal: ctx.signal,
      });
    }

    const checks: Check<QaResult>[] = [
      (r) => r.answer.trim().length > 0,
      (r) => r.answer.length <= ANSWER_CAP,
      (r) => r.cited_facts.every((id) => known.has(id)),
    ];

    const system =
      "You answer questions about the user's finances using ONLY the provided facts. " +
      "Cite the fact ids you used in cited_facts. Never invent numbers or ids.";
    const prompt =
      `Question: ${params.question}\n` +
      `Valid fact ids you may cite: ${[...known].join(", ")}.\n` +
      `Facts: ${factsText}`;

    ctx.onProgress?.({ step: "generate", label: "Answering…" });
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      ctx.signal?.throwIfAborted?.();
      const draft = await generateStructured<QaResult>(ctx.provider, {
        system,
        prompt,
        schema: schemaForFeature("free_form_qa")!,
        signal: ctx.signal,
      });
      try {
        const result = verify(draft, checks);
        ctx.onProgress?.({ step: "done", label: "Done" });
        return result;
      } catch {
        if (attempt === MAX_RETRIES) {
          throw new OnDeviceError(
            "verify_failed",
            "Could not produce a grounded answer.",
          );
        }
      }
    }
    throw new OnDeviceError(
      "verify_failed",
      "Could not produce a grounded answer.",
    );
  });
}
