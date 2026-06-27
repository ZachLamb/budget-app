type ChatEvidenceCategorySpending = {
  type: "category_spending";
  month: string;
  lines: { category: string; amount: number }[];
};

type ChatEvidenceGoalProgress = {
  type: "goal_progress";
  goals: {
    name: string;
    goal_type: string;
    current_amount: number;
    target_amount: number;
    pct_complete: number;
  }[];
};

type ChatEvidenceBudgetPace = {
  type: "budget_pace";
  month: string;
  lines: { category: string; budgeted: number; spent: number; remaining: number }[];
};

export type ChatEvidenceItem =
  | ChatEvidenceCategorySpending
  | ChatEvidenceGoalProgress
  | ChatEvidenceBudgetPace;
