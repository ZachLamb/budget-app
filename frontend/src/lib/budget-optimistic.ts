import type { BudgetMonthResponse } from "@/lib/api/budget";

/**
 * Optimistically apply an assignment edit to a cached budget month response,
 * keeping every figure the page renders in sync until the refetch lands:
 * the category row, its group header aggregates, and the month totals.
 *
 * Mirrors the server math (see backend routes/budget.py): `available` is
 * cumulative (assigned + activity + carryover); income-group assignments
 * still reduce Ready to Assign but are excluded from `total_assigned` /
 * `total_available`.
 */
export function applyAssignedOptimistic(
  old: BudgetMonthResponse,
  upsert: { category_id: string; assigned_amount: number },
): BudgetMonthResponse {
  let delta = 0;
  let isIncome = false;
  const groups = old.groups.map((g) => {
    if (!g.categories.some((c) => c.category_id === upsert.category_id)) return g;
    isIncome = g.is_income;
    const categories = g.categories.map((c) => {
      if (c.category_id !== upsert.category_id) return c;
      delta = upsert.assigned_amount - c.assigned;
      return {
        ...c,
        assigned: upsert.assigned_amount,
        available: upsert.assigned_amount + c.activity + c.carryover,
      };
    });
    return { ...g, categories, assigned: g.assigned + delta, available: g.available + delta };
  });
  return {
    ...old,
    groups,
    total_assigned: isIncome ? old.total_assigned : old.total_assigned + delta,
    total_available: isIncome ? old.total_available : old.total_available + delta,
    ready_to_assign: old.ready_to_assign - delta,
  };
}
