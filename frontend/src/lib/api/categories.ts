import api from "./client";

export interface Category {
  id: string;
  group_id: string;
  name: string;
  sort_order: number;
  goal_type: string;
  goal_amount: number | null;
  goal_target_date: string | null;
  created_at: string;
}

export interface CategoryGroup {
  id: string;
  household_id: string;
  name: string;
  sort_order: number;
  is_income: boolean;
  created_at: string;
  categories: Category[];
}

export interface CategoryUsage {
  transactions: number;
  budget_entries: number;
  rules: number;
  payees: number;
  recurring: number;
}

export type CategoryUsageMap = Record<string, CategoryUsage>;

export const categoriesApi = {
  listGroups: () => api.get<CategoryGroup[]>("/categories/groups").then((r) => r.data),
  createGroup: (data: { name: string; sort_order?: number; is_income?: boolean }) =>
    api.post<CategoryGroup>("/categories/groups", data).then((r) => r.data),
  updateGroup: (id: string, data: Partial<{ name: string; sort_order: number; is_income: boolean }>) =>
    api.put<CategoryGroup>(`/categories/groups/${id}`, data).then((r) => r.data),
  deleteGroup: (id: string) => api.delete(`/categories/groups/${id}`),
  create: (data: { group_id: string; name: string; sort_order?: number }) =>
    api.post<Category>("/categories", data).then((r) => r.data),
  update: (id: string, data: Partial<{ name: string; group_id: string }>) =>
    api.put<Category>(`/categories/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/categories/${id}`),
  usage: () => api.get<CategoryUsageMap>("/categories/usage").then((r) => r.data),
  reorderGroups: (ordered_ids: string[]) => api.put("/categories/groups/order", { ordered_ids }),
  reorderCategories: (group_id: string, ordered_ids: string[]) =>
    api.put("/categories/order", { group_id, ordered_ids }),
};
