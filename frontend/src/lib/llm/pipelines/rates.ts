import { schemaForFeature } from "../schema";
import { withNanoSlot } from "../session-pool";
import { generateVerified, ground, type Check } from "./steps";
import type { PipelineContext } from "./types";

export interface DebtFact {
  account_id: string;
  name: string;
  type: string;
  balance: number;
  has_apr: boolean;
  has_min_payment: boolean;
  current_apr: number | null;
  current_min_payment: number | null;
}

export interface DebtFacts {
  accounts: DebtFact[];
}

export interface RateSuggestion {
  account_id: string;
  suggested_apr: number;
  suggested_min_payment: number;
  reasoning: string;
}

export interface RateResult {
  suggestions: RateSuggestion[];
}

const APR_MAX = 0.35;

/**
 * `debt_rate_suggestions` on-device pipeline:
 * ground → generate(schema) → verify (bounded retries).
 * Output flows into a financial-data write, so the deterministic verifier is
 * the source of truth: every suggestion must cite a grounded account, APR must
 * stay within `[0, 0.35]`, the minimum payment must not exceed the balance, and
 * the reasoning must be non-empty. Suggestions are only requested for accounts
 * missing an APR or minimum payment.
 */
export async function runRatesPipeline(
  ctx: PipelineContext,
): Promise<RateResult> {
  return withNanoSlot(async () => {
    ctx.onProgress?.({ step: "ground", label: "Reading your debt accounts…" });
    const facts = await ground<DebtFacts>("/ai/facts/debt", ctx.signal);

    const byId = new Map(facts.accounts.map((a) => [a.account_id, a]));
    const eligible = facts.accounts.filter(
      (a) => !a.has_apr || !a.has_min_payment,
    );

    const checks: Check<RateResult>[] = [
      ({ suggestions }) => suggestions.every((s) => byId.has(s.account_id)),
      ({ suggestions }) =>
        suggestions.every(
          (s) => s.suggested_apr >= 0 && s.suggested_apr <= APR_MAX,
        ),
      ({ suggestions }) =>
        suggestions.every((s) => {
          const a = byId.get(s.account_id);
          if (!a) return false;
          return (
            s.suggested_min_payment >= 0 &&
            s.suggested_min_payment <= Math.abs(a.balance)
          );
        }),
      ({ suggestions }) =>
        suggestions.every((s) => s.reasoning.trim().length > 0),
    ];

    const system =
      "You suggest conservative STARTING-POINT estimates for missing credit/loan APR and " +
      "minimum payment. Only use the provided account_id values. APR is a fraction (e.g. 0.2299) " +
      "and must never exceed 0.35. Minimum payment must not exceed the balance. These are " +
      "estimates the user must verify on their statements.";
    const prompt =
      `Suggest apr and minimum payment ONLY for these accounts missing data.\n` +
      `Use ONLY these account_id values: ${eligible.map((a) => a.account_id).join(", ")}.\n` +
      `Facts: ${JSON.stringify(eligible)}`;

    ctx.onProgress?.({ step: "generate", label: "Estimating rates…" });
    const result = await generateVerified<RateResult>(
      ctx.provider,
      {
        system,
        prompt,
        schema: schemaForFeature("debt_rate_suggestions")!,
        signal: ctx.signal,
      },
      checks,
      { signal: ctx.signal },
    );
    ctx.onProgress?.({ step: "done", label: "Done" });
    return result;
  });
}
