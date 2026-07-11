import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DndContext } from "@dnd-kit/core";
import { GroupItem } from "./group-item";
import { categoriesApi, type CategoryGroup } from "@/lib/api/categories";

vi.mock("@/lib/api/categories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/categories")>();
  return {
    ...actual,
    categoriesApi: { ...actual.categoriesApi, create: vi.fn(), updateGroup: vi.fn() },
  };
});

const group: CategoryGroup = {
  id: "g1", household_id: "h1", name: "Everyday", sort_order: 0,
  is_income: false, created_at: "2026-01-01T00:00:00Z",
  categories: [{
    id: "c1", group_id: "g1", name: "Groceries", sort_order: 0,
    goal_type: "none", goal_amount: null, goal_target_date: null,
    created_at: "2026-01-01T00:00:00Z",
  }],
};

function renderGroup(over: Partial<Parameters<typeof GroupItem>[0]> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <DndContext>
        <GroupItem
          group={group}
          groups={[group]}
          expanded
          onToggle={() => {}}
          onRequestDelete={() => {}}
          onRequestDeleteCategory={() => {}}
          {...over}
        />
      </DndContext>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(categoriesApi.create).mockReset());

describe("GroupItem", () => {
  it("marks the header toggle with aria-expanded and hides categories when collapsed", () => {
    renderGroup({ expanded: false });
    // ^Everyday: the delete/add buttons' aria-labels also contain the group
    // name but start with "Delete"/"Add", so anchor to the toggle only.
    const toggle = screen.getByRole("button", { name: /^Everyday/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Groceries")).not.toBeInTheDocument();
  });

  it("does not submit a whitespace-only category name", () => {
    renderGroup();
    const input = screen.getByPlaceholderText("Add category...");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(categoriesApi.create).not.toHaveBeenCalled();
  });

  it("keeps the typed name when the create request fails", async () => {
    vi.mocked(categoriesApi.create).mockRejectedValueOnce(new Error("boom"));
    renderGroup();
    const input = screen.getByPlaceholderText("Add category...");
    fireEvent.change(input, { target: { value: "Coffee" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(categoriesApi.create).toHaveBeenCalledOnce());
    expect((input as HTMLInputElement).value).toBe("Coffee");
  });

  it("clears the input only after a successful create", async () => {
    vi.mocked(categoriesApi.create).mockResolvedValue({
      id: "c2", group_id: "g1", name: "Coffee", sort_order: 1,
      goal_type: "none", goal_amount: null, goal_target_date: null,
      created_at: "2026-01-01T00:00:00Z",
    });
    renderGroup();
    const input = screen.getByPlaceholderText("Add category...");
    fireEvent.change(input, { target: { value: "Coffee" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });
});
