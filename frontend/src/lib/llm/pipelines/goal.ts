import { schemaForFeature } from "../schema";
import { withNanoSlot } from "../session-pool";
import { generateVerified, ground, type Check } from "./steps";
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

/**
 * `goal_planning` on-device pipeline:
 * ground → generate(schema) → verify (bounded retries).
 * The verifier rejects fabricated goal ids and arithmetic that doesn't
 * reconcile with `(target - current) / monthly_contribution` (±1 month).
 */
export async function runGoalPipeline(
  ctx: PipelineContext,
  params?: { goalId?: string },
): Promise<GoalResult> {
  return withNanoSlot(async () => {
    ctx.onProgress?.({ step: "ground", label: "Checking your goals…" });
    const facts = await ground<GoalFacts>("/ai/facts/goal", ctx.signal);

    const byId = new Map(facts.goals.map((g) => [g.goal_id, g]));

    // When a specific goal is requested (and it exists), constrain the prompt
    // and the verifier to that single goal; otherwise let the model pick one.
    const targetId = params?.goalId;
    const candidates =
      targetId && byId.has(targetId)
        ? facts.goals.filter((g) => g.goal_id === targetId)
        : facts.goals;

    const checks: Check<GoalResult>[] = [
      ({ plan }) => byId.has(plan.goal_id),
      ({ plan }) => (targetId ? plan.goal_id === targetId : true),
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
      `Propose a contribution plan for ${targetId ? "this goal" : "ONE of these goals"}.\n` +
      `Use ONLY these goal_id values: ${candidates.map((g) => g.goal_id).join(", ")}.\n` +
      `Facts: ${JSON.stringify(candidates)}`;

    ctx.onProgress?.({ step: "generate", label: "Building a plan…" });
    const result = await generateVerified<GoalResult>(
      ctx.provider,
      {
        system,
        prompt,
        schema: schemaForFeature("goal_planning")!,
        signal: ctx.signal,
      },
      checks,
      { signal: ctx.signal },
    );
    ctx.onProgress?.({ step: "done", label: "Done" });
    return result;
  });
}
