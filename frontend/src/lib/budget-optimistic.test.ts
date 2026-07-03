import { describe, it, expect } from "vitest";
import type { BudgetMonthResponse } from "@/lib/api/budget";
import { applyAssignedOptimistic } from "./budget-optimistic";

function month(): BudgetMonthResponse {
  return {
    month: "2026-07",
    total_income: 1000,
    total_assigned: 300,
    total_activity: -120,
    total_available: 230,
    ready_to_assign: 650,
    total_carryover_in: 50,
    overspend_deducted: 0,
    groups: [
      {
        group_id: "g-income",
        group_name: "Income",
        sort_order: 0,
        is_income: true,
        assigned: 0,
        activity: 1000,
        available: 1000,
        carryover: 0,
        categories: [
          {
            category_id: "c-pay",
            category_name: "Paycheck",
            group_id: "g-income",
            assigned: 0,
            activity: 1000,
            available: 1000,
            carryover: 0,
          },
        ],
      },
      {
        group_id: "g-exp",
        group_name: "Essentials",
        sort_order: 1,
        is_income: false,
        assigned: 300,
        activity: -120,
        available: 230,
        carryover: 50,
        categories: [
          {
            category_id: "c-food",
            category_name: "Food",
            group_id: "g-exp",
            assigned: 200,
            activity: -100,
            available: 150,
            carryover: 50,
          },
          {
            category_id: "c-gas",
            category_name: "Gas",
            group_id: "g-exp",
            assigned: 100,
            activity: -20,
            available: 80,
            carryover: 0,
          },
        ],
      },
    ],
  };
}

describe("applyAssignedOptimistic", () => {
  it("updates the category row including carryover in available", () => {
    const next = applyAssignedOptimistic(month(), { category_id: "c-food", assigned_amount: 250 });
    const food = next.groups[1].categories[0];
    expect(food.assigned).toBe(250);
    expect(food.available).toBe(250 - 100 + 50);
  });

  it("keeps the group header aggregates in sync", () => {
    const next = applyAssignedOptimistic(month(), { category_id: "c-food", assigned_amount: 250 });
    expect(next.groups[1].assigned).toBe(350);
    expect(next.groups[1].available).toBe(280);
  });

  it("adjusts totals and Ready to Assign by the delta", () => {
    const next = applyAssignedOptimistic(month(), { category_id: "c-food", assigned_amount: 250 });
    expect(next.total_assigned).toBe(350);
    expect(next.total_available).toBe(280);
    expect(next.ready_to_assign).toBe(600);
  });

  it("leaves untouched groups and categories alone", () => {
    const next = applyAssignedOptimistic(month(), { category_id: "c-food", assigned_amount: 250 });
    expect(next.groups[0]).toEqual(month().groups[0]);
    expect(next.groups[1].categories[1]).toEqual(month().groups[1].categories[1]);
  });

  it("reduces Ready to Assign but not total_assigned for income-group edits", () => {
    const next = applyAssignedOptimistic(month(), { category_id: "c-pay", assigned_amount: 40 });
    expect(next.ready_to_assign).toBe(610);
    expect(next.total_assigned).toBe(300);
    expect(next.total_available).toBe(230);
    expect(next.groups[0].assigned).toBe(40);
  });

  it("is a no-op for an unknown category", () => {
    const next = applyAssignedOptimistic(month(), { category_id: "missing", assigned_amount: 99 });
    expect(next).toEqual(month());
  });
});
