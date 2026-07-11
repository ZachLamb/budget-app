import { arrayMove } from "@dnd-kit/sortable";
import type { CategoryGroup } from "@/lib/api/categories";

/** Returns the reordered group list, or null when the drag is a no-op. */
export function moveGroup(
  groups: CategoryGroup[],
  activeId: string,
  overId: string,
): CategoryGroup[] | null {
  const from = groups.findIndex((g) => g.id === activeId);
  const to = groups.findIndex((g) => g.id === overId);
  if (from < 0 || to < 0 || from === to) return null;
  return arrayMove(groups, from, to);
}

/** Reorders a category within its group; null for cross-group or unknown ids. */
export function moveCategory(
  groups: CategoryGroup[],
  groupId: string,
  activeId: string,
  overId: string,
): CategoryGroup[] | null {
  const groupIndex = groups.findIndex((g) => g.id === groupId);
  if (groupIndex < 0) return null;
  const cats = groups[groupIndex].categories;
  const from = cats.findIndex((c) => c.id === activeId);
  const to = cats.findIndex((c) => c.id === overId);
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...groups];
  next[groupIndex] = { ...groups[groupIndex], categories: arrayMove(cats, from, to) };
  return next;
}
