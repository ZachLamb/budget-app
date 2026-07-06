import { schemaForFeature } from "../schema";
import { withNanoSlot } from "../session-pool";
import { summarize } from "../specialized";
import { amountsAreGrounded, collectAmountsCents } from "./grounded-amounts";
import { detectIntent, prepareAction } from "./intent";
import { buildQaPrompt, buildQaSystem, type SearchMatch } from "./qa-prompt";
import { generateVerified, ground, type Check } from "./steps";
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

export type QaAnswerResult = {
  kind: "answer";
  answer: string;
  cited_facts: string[];
};

export type QaActionResult = {
  kind: "action";
  preview: string;
  confirmationToken: string;
  actionType: string;
  data: Record<string, unknown>;
};

export type QaResult = QaAnswerResult | QaActionResult;

export interface QaParams {
  question: string;
}

interface SearchFacts {
  query_terms: string[];
  matches: SearchMatch[];
}

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

async function groundSearch(
  question: string,
  signal?: AbortSignal,
): Promise<SearchMatch[]> {
  try {
    const r = await ground<SearchFacts>(
      `/ai/facts/search?q=${encodeURIComponent(question.slice(0, 500))}`,
      signal,
    );
    return r.matches ?? [];
  } catch {
    return [];
  }
}

async function runAnswerPipeline(
  ctx: PipelineContext,
  params: QaParams,
): Promise<QaAnswerResult> {
  ctx.onProgress?.({ step: "ground", label: "Gathering your data…" });
  const [facts, matches] = await Promise.all([
    ground<ContextFacts>("/ai/facts/context", ctx.signal),
    groundSearch(params.question, ctx.signal),
  ]);
  const known = knownFactIds(facts);
  for (const m of matches) known.add(m.id);

  let factsText = JSON.stringify(facts);
  if (factsText.length > CONDENSE_THRESHOLD) {
    ctx.onProgress?.({ step: "condense", label: "Condensing context…" });
    factsText = await summarize(ctx.provider, factsText, {
      signal: ctx.signal,
    });
  }

  const allowedAmounts = collectAmountsCents({ facts, matches });
  const checks: Check<{ answer: string; cited_facts: string[] }>[] = [
    (r) => r.answer.trim().length > 0,
    (r) => r.answer.length <= ANSWER_CAP,
    (r) => r.cited_facts.every((id) => known.has(id)),
    (r) => amountsAreGrounded(r.answer, allowedAmounts),
  ];

  const system = buildQaSystem();
  const prompt = buildQaPrompt(params.question, [...known], factsText, matches);

  ctx.onProgress?.({ step: "generate", label: "Answering…" });
  // Heartbeat: without this the "generate" label sits static for the whole
  // 10–60s on-device generation. Emit every ~120 streamed characters.
  let lastHeartbeat = 0;
  const result = await generateVerified(
    ctx.provider,
    {
      system,
      prompt,
      schema: schemaForFeature("free_form_qa")!,
      signal: ctx.signal,
      onToken: (chars) => {
        if (chars - lastHeartbeat >= 120) {
          lastHeartbeat = chars;
          ctx.onProgress?.({
            step: "generate",
            label: `Writing the answer… (${chars} characters)`,
          });
        }
      },
    },
    checks,
    { signal: ctx.signal, onProgress: ctx.onProgress },
  );
  return { kind: "answer", ...result };
}

/**
 * `free_form_qa` on-device pipeline:
 * intent → prepare-action OR ground → generate(schema) → verify (retry).
 */
export async function runQaPipeline(
  ctx: PipelineContext,
  params: QaParams,
): Promise<QaResult> {
  return withNanoSlot(async () => {
    ctx.onProgress?.({ step: "ground", label: "Understanding your request…" });
    const intent = await detectIntent(ctx.provider, params.question, ctx.signal);
    if (intent) {
      ctx.onProgress?.({ step: "generate", label: "Preparing action…" });
      const prepared = await prepareAction(
        intent.action_type,
        intent.data,
        ctx.signal,
      );
      if (!prepared.ok || !prepared.confirmation_token) {
        // `preview` must remain server-authored (see prepare.py) and must
        // never interpolate free-form model text: this path bypasses the
        // grounded-amounts/citation verifier that every other answer goes
        // through, so an ungrounded/model-influenced string here would ship
        // unchecked.
        return {
          kind: "answer",
          answer: prepared.preview,
          cited_facts: [],
        };
      }
      ctx.onProgress?.({ step: "done", label: "Done" });
      return {
        kind: "action",
        preview: prepared.preview,
        confirmationToken: prepared.confirmation_token,
        actionType: intent.action_type,
        data: prepared.normalized_data,
      };
    }

    const answer = await runAnswerPipeline(ctx, params);
    ctx.onProgress?.({ step: "done", label: "Done" });
    return answer;
  });
}
