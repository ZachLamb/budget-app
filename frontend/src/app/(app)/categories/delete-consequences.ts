import type { CategoryGroup, CategoryUsage, CategoryUsageMap } from "@/lib/api/categories";

export interface DeleteConsequence {
  blocked: boolean;
  message: string;
}

const BLOCKERS: Array<[keyof CategoryUsage, string, string]> = [
  ["budget_entries", "budget entry", "budget entries"],
  ["rules", "rule", "rules"],
  ["payees", "payee default", "payee defaults"],
  ["recurring", "recurring item", "recurring items"],
];

function blockerPhrases(usage: CategoryUsage): string[] {
  return BLOCKERS.flatMap(([key, singular, plural]) => {
    const count = usage[key];
    return count > 0 ? [`${count} ${count === 1 ? singular : plural}`] : [];
  });
}

function txPhrase(count: number): string {
  return `${count} transaction${count === 1 ? "" : "s"} will become uncategorized.`;
}

export function describeCategoryDelete(usage: CategoryUsage | undefined): DeleteConsequence {
  if (usage) {
    const phrases = blockerPhrases(usage);
    if (phrases.length > 0) {
      return {
        blocked: true,
        message: `Can't delete this category yet — it's used by ${phrases.join(" and ")}. Remove those first.`,
      };
    }
    if (usage.transactions > 0) {
      return { blocked: false, message: `This will permanently delete this category. ${txPhrase(usage.transactions)}` };
    }
  }
  return { blocked: false, message: "This will permanently delete this category." };
}

export function describeGroupDelete(
  group: CategoryGroup | undefined,
  usageMap: CategoryUsageMap | undefined,
): DeleteConsequence {
  const base = "This will permanently delete this group and all its categories.";
  if (!group || !usageMap) return { blocked: false, message: base };
  const blockedNames = group.categories
    .filter((cat) => usageMap[cat.id] && blockerPhrases(usageMap[cat.id]).length > 0)
    .map((cat) => `'${cat.name}'`);
  if (blockedNames.length > 0) {
    return {
      blocked: true,
      message:
        `Can't delete this group yet — ${blockedNames.join(", ")} ` +
        `${blockedNames.length === 1 ? "is" : "are"} still used by budgets, rules, payees, or recurring items. Remove those first.`,
    };
  }
  const transactions = group.categories.reduce((sum, cat) => sum + (usageMap[cat.id]?.transactions ?? 0), 0);
  if (transactions > 0) return { blocked: false, message: `${base} ${txPhrase(transactions)}` };
  return { blocked: false, message: base };
}
