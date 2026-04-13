export type ChatEvidenceCategorySpending = {
  type: "category_spending";
  month: string;
  lines: { category: string; amount: number }[];
};

export type ChatEvidenceGoalProgress = {
  type: "goal_progress";
  goals: {
    name: string;
    goal_type: string;
    current_amount: number;
    target_amount: number;
    pct_complete: number;
  }[];
};

export type ChatEvidenceBudgetPace = {
  type: "budget_pace";
  month: string;
  lines: { category: string; budgeted: number; spent: number; remaining: number }[];
};

export type ChatEvidenceItem =
  | ChatEvidenceCategorySpending
  | ChatEvidenceGoalProgress
  | ChatEvidenceBudgetPace;

export function parseChatEvidence(raw: unknown): ChatEvidenceItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatEvidenceItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.type === "category_spending" && typeof o.month === "string" && Array.isArray(o.lines)) {
      out.push({
        type: "category_spending",
        month: o.month,
        lines: o.lines
          .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
          .map((l) => ({
            category: String(l.category ?? ""),
            amount: Number(l.amount) || 0,
          })),
      });
      continue;
    }
    if (o.type === "goal_progress" && Array.isArray(o.goals)) {
      out.push({
        type: "goal_progress",
        goals: o.goals
          .filter((g): g is Record<string, unknown> => !!g && typeof g === "object")
          .map((g) => ({
            name: String(g.name ?? ""),
            goal_type: String(g.goal_type ?? ""),
            current_amount: Number(g.current_amount) || 0,
            target_amount: Number(g.target_amount) || 0,
            pct_complete: Number(g.pct_complete) || 0,
          })),
      });
      continue;
    }
    if (o.type === "budget_pace" && typeof o.month === "string" && Array.isArray(o.lines)) {
      out.push({
        type: "budget_pace",
        month: o.month,
        lines: o.lines
          .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
          .map((l) => ({
            category: String(l.category ?? ""),
            budgeted: Number(l.budgeted) || 0,
            spent: Number(l.spent) || 0,
            remaining: Number(l.remaining) || 0,
          })),
      });
    }
  }
  return out;
}
