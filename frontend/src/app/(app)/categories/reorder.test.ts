import { describe, it, expect } from "vitest";
import { moveGroup, moveCategory } from "./reorder";
import type { CategoryGroup } from "@/lib/api/categories";

const cat = (id: string, group_id: string) => ({
  id, group_id, name: id, sort_order: 0, goal_type: "none",
  goal_amount: null, goal_target_date: null, created_at: "2026-01-01T00:00:00Z",
});

const grp = (id: string, catIds: string[] = []): CategoryGroup => ({
  id, household_id: "h1", name: id, sort_order: 0, is_income: false,
  created_at: "2026-01-01T00:00:00Z", categories: catIds.map((c) => cat(c, id)),
});

describe("moveGroup", () => {
  it("moves a group to the target position", () => {
    const next = moveGroup([grp("a"), grp("b"), grp("c")], "c", "a");
    expect(next!.map((g) => g.id)).toEqual(["c", "a", "b"]);
  });
  it("returns null for unknown ids or same position", () => {
    const groups = [grp("a"), grp("b")];
    expect(moveGroup(groups, "zzz", "a")).toBeNull();
    expect(moveGroup(groups, "a", "a")).toBeNull();
  });
});

describe("moveCategory", () => {
  it("reorders within the group without touching others", () => {
    const groups = [grp("g1", ["x", "y", "z"]), grp("g2", ["q"])];
    const next = moveCategory(groups, "g1", "z", "x");
    expect(next![0].categories.map((c) => c.id)).toEqual(["z", "x", "y"]);
    expect(next![1]).toBe(groups[1]);
  });
  it("returns null when the target is not in the group (cross-group drag)", () => {
    const groups = [grp("g1", ["x"]), grp("g2", ["q"])];
    expect(moveCategory(groups, "g1", "x", "q")).toBeNull();
  });
});
