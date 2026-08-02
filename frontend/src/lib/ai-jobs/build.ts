/**
 * Build a job batch from an exported bundle, splitting cheap work from
 * expensive work.
 *
 * The split is the point: Chrome's Gemini Nano is on-device (so equally
 * private) and instant, but small. A transaction whose payee you have already
 * categorized consistently doesn't need a 7B model — it needs a lookup. Those
 * are settled here, in the browser, and never enter the exported batch. Only
 * genuinely ambiguous transactions are handed to the local model, which keeps
 * the batch inside its context window and makes its answers better.
 */

import { schemaForFeature } from "@/lib/llm/schema";
import { maxTokensFor } from "@/lib/llm/max-tokens";

import {
  JOBS_KIND,
  JOBS_SCHEMA_VERSION,
  type AiJob,
  type AiJobBundle,
} from "./types";

/** Shape of the export produced by GET /api/ai-bundle/export. */
export interface ExportedTransaction {
  id: string;
  date: string | null;
  amount: number | null;
  payee_id: string | null;
  payee: string | null;
  category_id: string | null;
  notes: string | null;
}

export interface ExportedCategory {
  id: string;
  name: string;
  group: string;
  is_income: boolean;
}

export interface ExportBundle {
  kind: string;
  schema_version: number;
  scope: string;
  categories: ExportedCategory[];
  transactions: ExportedTransaction[];
  examples?: ExportedTransaction[];
}

/** A categorization the local model never needs to see. */
export interface SettledSuggestion {
  transaction_id: string;
  category_id: string;
  confidence: number;
  reason: string;
  source: string;
}

export interface TriageResult {
  /** Decided from the household's own history — apply without a model. */
  settled: SettledSuggestion[];
  /** Ambiguous; these become the exported batch. */
  bundle: AiJobBundle;
}

/** How many transactions go in one job. Keeps each prompt well inside context. */
export const JOB_BATCH_SIZE = 25;

/**
 * Minimum share of a payee's history that must agree before we settle a
 * transaction without asking a model. Deliberately strict — a wrong
 * auto-applied category is worse than asking.
 */
const HISTORY_AGREEMENT = 0.8;
/** A single prior sighting isn't a pattern. */
const MIN_HISTORY = 2;

function normalizePayee(payee: string | null): string {
  return (payee ?? "").trim().toLowerCase();
}

/**
 * Find payees whose past categorization is consistent enough to reuse.
 * Returns payee -> {categoryId, agreement, count}.
 */
function buildHistory(
  examples: ExportedTransaction[],
): Map<string, { categoryId: string; agreement: number; count: number }> {
  const counts = new Map<string, Map<string, number>>();
  for (const txn of examples) {
    const key = normalizePayee(txn.payee);
    if (!key || !txn.category_id) continue;
    const byCategory = counts.get(key) ?? new Map<string, number>();
    byCategory.set(txn.category_id, (byCategory.get(txn.category_id) ?? 0) + 1);
    counts.set(key, byCategory);
  }

  const history = new Map<
    string,
    { categoryId: string; agreement: number; count: number }
  >();
  for (const [payee, byCategory] of counts) {
    let topCategory = "";
    let topCount = 0;
    let total = 0;
    for (const [categoryId, n] of byCategory) {
      total += n;
      if (n > topCount) {
        topCount = n;
        topCategory = categoryId;
      }
    }
    if (total >= MIN_HISTORY) {
      history.set(payee, {
        categoryId: topCategory,
        agreement: topCount / total,
        count: total,
      });
    }
  }
  return history;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const SYSTEM_PROMPT = [
  "You categorize personal financial transactions.",
  "Choose the single best category id for each transaction from the provided list.",
  "Only use category ids that appear in the list.",
  "If genuinely unsure, omit the transaction rather than guessing.",
].join(" ");

function buildPrompt(
  transactions: ExportedTransaction[],
  categories: ExportedCategory[],
  examples: ExportedTransaction[],
  categoryNames: Map<string, string>,
): string {
  const categoryList = categories
    .map((c) => `- ${c.id} :: ${c.group} / ${c.name}`)
    .join("\n");

  const exampleLines = examples
    .slice(0, 20)
    .map(
      (t) =>
        `- "${t.payee ?? "unknown"}" -> ${categoryNames.get(t.category_id ?? "") ?? t.category_id}`,
    )
    .join("\n");

  const txnLines = transactions
    .map(
      (t) =>
        `- id=${t.id} date=${t.date ?? "?"} amount=${t.amount ?? "?"} payee="${t.payee ?? "unknown"}"${
          t.notes ? ` notes="${t.notes}"` : ""
        }`,
    )
    .join("\n");

  return [
    "Categories:",
    categoryList,
    "",
    exampleLines ? "How this household has categorized before:" : "",
    exampleLines,
    "",
    "Categorize these transactions:",
    txnLines,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Split an export into locally-settled suggestions and an exportable batch.
 *
 * `settleFromHistory` is on by default; pass false to send everything to the
 * local model (useful when you want a second opinion on the easy ones).
 */
export function buildJobBundle(
  exported: ExportBundle,
  options: { settleFromHistory?: boolean; suggestedModel?: string } = {},
): TriageResult {
  const { settleFromHistory = true, suggestedModel } = options;
  const examples = exported.examples ?? [];
  const categoryNames = new Map(exported.categories.map((c) => [c.id, c.name]));
  const validCategories = new Set(exported.categories.map((c) => c.id));
  const history = settleFromHistory ? buildHistory(examples) : new Map();

  const settled: SettledSuggestion[] = [];
  const ambiguous: ExportedTransaction[] = [];

  for (const txn of exported.transactions) {
    const match = history.get(normalizePayee(txn.payee));
    if (
      match &&
      match.agreement >= HISTORY_AGREEMENT &&
      validCategories.has(match.categoryId)
    ) {
      settled.push({
        transaction_id: txn.id,
        category_id: match.categoryId,
        confidence: match.agreement,
        reason: `Matched ${match.count} prior transaction(s) from "${txn.payee}".`,
        source: "history",
      });
    } else {
      ambiguous.push(txn);
    }
  }

  const feature = "categorize_transaction" as const;
  const jobs: AiJob[] = chunk(ambiguous, JOB_BATCH_SIZE).map((batch, i) => ({
    id: `categorize-${i + 1}`,
    feature,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(batch, exported.categories, examples, categoryNames),
    responseSchema: schemaForFeature(feature),
    maxTokens: maxTokensFor(feature),
    meta: { transactionIds: batch.map((t) => t.id) },
  }));

  return {
    settled,
    bundle: {
      kind: JOBS_KIND,
      schemaVersion: JOBS_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      ...(suggestedModel ? { suggestedModel } : {}),
      jobs,
    },
  };
}
