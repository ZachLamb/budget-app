export type ChatEvidenceCategorySpending = {
  type: "category_spending";
  month: string;
  lines: { category: string; amount: number }[];
};

export type ChatEvidenceItem = ChatEvidenceCategorySpending;

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
    }
  }
  return out;
}
