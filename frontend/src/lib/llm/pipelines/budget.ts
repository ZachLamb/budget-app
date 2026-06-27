import { schemaForFeature } from "../schema";
import { withNanoSlot } from "../session-pool";
import { generateVerified, ground, type Check } from "./steps";
import type { PipelineContext } from "./types";

export interface BudgetFacts {
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
}

export interface BudgetRecommendation {
  category_id: string;
  suggested_amount: number;
  rationale: string;
}

export interface BudgetResult {
  recommendations: BudgetRecommendation[];
}

/**
 * `budget_recommendations` on-device pipeline:
 * ground → generate(schema) → verify (bounded retries).
 * The deterministic verifier is the source of truth: a draft is accepted only
 * if every recommendation cites a real category and a sane amount.
 */
export async function runBudgetPipeline(
  ctx: PipelineContext,
): Promise<BudgetResult> {
  return withNanoSlot(async () => {
    ctx.onProgress?.({ step: "ground", label: "Checking your budget…" });
    const facts = await ground<BudgetFacts>("/ai/facts/budget", ctx.signal);

    const known = new Set(facts.categories.map((c) => c.category_id));
    const maxAmount =
      Math.max(
        facts.total_budgeted * 1.5,
        ...facts.categories.map((c) => c.actual),
      ) || Number.MAX_SAFE_INTEGER;

    const checks: Check<BudgetResult>[] = [
      (r) => r.recommendations.length > 0,
      (r) => r.recommendations.every((x) => known.has(x.category_id)),
      (r) =>
        r.recommendations.every(
          (x) => x.suggested_amount >= 0 && x.suggested_amount <= maxAmount,
        ),
      (r) => r.recommendations.every((x) => x.rationale.trim().length > 0),
    ];

    const overBudget = facts.categories.filter((c) => c.remaining < 0);
    const system =
      "You are a careful budgeting assistant. Only use the provided category IDs. Return amounts in dollars.";
    const prompt =
      `Suggest adjusted monthly budget amounts for these over-budget categories.\n` +
      `Use ONLY these category_id values: ${[...known].join(", ")}.\n` +
      `Facts: ${JSON.stringify({ month: facts.month, overBudget })}`;

    ctx.onProgress?.({ step: "generate", label: "Writing recommendations…" });
    const result = await generateVerified<BudgetResult>(
      ctx.provider,
      {
        system,
        prompt,
        schema: schemaForFeature("budget_recommendations")!,
        signal: ctx.signal,
      },
      checks,
      { signal: ctx.signal },
    );
    ctx.onProgress?.({ step: "done", label: "Done" });
    return result;
  });
}
