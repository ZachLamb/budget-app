import { OnDeviceError } from "../errors";
import { schemaForFeature } from "../schema";
import { withNanoSlot } from "../session-pool";
import { generateStructured, ground, verify, type Check } from "./steps";
import type { PipelineContext } from "./types";

export interface GoalFacts {
  goals: {
    goal_id: string;
    name: string;
    target_amount: number;
    current_amount: number;
    monthly_contribution: number;
    months_remaining: number | null;
  }[];
}

export interface GoalPlan {
  goal_id: string;
  monthly_contribution: number;
  months_to_target: number;
  note: string;
}

export interface GoalResult {
  plan: GoalPlan;
}

const MAX_RETRIES = 2;

/**
 * `goal_planning` on-device pipeline:
 * ground → generate(schema) → verify (retry up to MAX_RETRIES).
 * The verifier rejects fabricated goal ids and arithmetic that doesn't
 * reconcile with `(target - current) / monthly_contribution` (±1 month).
 */
export async function runGoalPipeline(
  ctx: PipelineContext,
): Promise<GoalResult> {
  return withNanoSlot(async () => {
    ctx.onProgress?.({ step: "ground", label: "Checking your goals…" });
    const facts = await ground<GoalFacts>("/ai/facts/goal", ctx.signal);

    const byId = new Map(facts.goals.map((g) => [g.goal_id, g]));

    const checks: Check<GoalResult>[] = [
      ({ plan }) => byId.has(plan.goal_id),
      ({ plan }) => plan.monthly_contribution >= 0,
      ({ plan }) => plan.note.trim().length > 0,
      ({ plan }) => {
        // Reconcile months_to_target with the math, unless contribution is 0
        // (then the target is unreachable and we don't constrain the value).
        if (plan.monthly_contribution <= 0) return true;
        const goal = byId.get(plan.goal_id)!;
        const expected = Math.ceil(
          Math.max(0, goal.target_amount - goal.current_amount) /
            plan.monthly_contribution,
        );
        return Math.abs(plan.months_to_target - expected) <= 1;
      },
    ];

    const system =
      "You are a careful savings-planning assistant. Only use the provided goal IDs and the given amounts. Do not invent numbers.";
    const prompt =
      `Propose a contribution plan for ONE of these goals.\n` +
      `Use ONLY these goal_id values: ${[...byId.keys()].join(", ")}.\n` +
      `Facts: ${JSON.stringify(facts.goals)}`;

    ctx.onProgress?.({ step: "generate", label: "Building a plan…" });
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      ctx.signal?.throwIfAborted?.();
      const draft = await generateStructured<GoalResult>(ctx.provider, {
        system,
        prompt,
        schema: schemaForFeature("goal_planning")!,
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
            "Could not produce a valid goal plan.",
          );
        }
      }
    }
    throw new OnDeviceError(
      "verify_failed",
      "Could not produce a valid goal plan.",
    );
  });
}
