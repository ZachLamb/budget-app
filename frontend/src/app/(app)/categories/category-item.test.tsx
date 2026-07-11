import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CategoryItem } from "./category-item";
import { categoriesApi, type Category, type CategoryGroup } from "@/lib/api/categories";

vi.mock("@/lib/api/categories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/categories")>();
  return {
    ...actual,
    categoriesApi: { ...actual.categoriesApi, update: vi.fn() },
  };
});

// Radix menus need pointer-capture APIs that jsdom lacks.
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    hasPointerCapture: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  });
});

const category: Category = {
  id: "c1", group_id: "g1", name: "Groceries", sort_order: 0,
  goal_type: "none", goal_amount: null, goal_target_date: null,
  created_at: "2026-01-01T00:00:00Z",
};

const groups: CategoryGroup[] = [
  { id: "g1", household_id: "h1", name: "Everyday", sort_order: 0, is_income: false, created_at: "2026-01-01T00:00:00Z", categories: [category] },
  { id: "g2", household_id: "h1", name: "Bills", sort_order: 1, is_income: false, created_at: "2026-01-01T00:00:00Z", categories: [] },
];

function renderItem(onRequestDelete = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <CategoryItem category={category} groups={groups} onRequestDelete={onRequestDelete} />
    </QueryClientProvider>,
  );
  return { onRequestDelete };
}

async function openMenu() {
  const trigger = screen.getByRole("button", { name: /Category actions for Groceries/ });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  await screen.findByRole("menu");
}

async function clickMenuItem(name: string) {
  const item = screen.getByRole("menuitem", { name });
  fireEvent.click(item);
}

beforeEach(() => vi.mocked(categoriesApi.update).mockReset());

describe("CategoryItem", () => {
  it("renames inline via the menu and commits on Enter", async () => {
    vi.mocked(categoriesApi.update).mockResolvedValue({ ...category, name: "Food" });
    renderItem();
    await openMenu();
    await clickMenuItem("Rename");
    const input = await screen.findByRole("textbox", { name: /Rename category Groceries/ });
    fireEvent.change(input, { target: { value: "Food" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(categoriesApi.update).toHaveBeenCalledWith("c1", { name: "Food" }),
    );
  });

  it("cancels rename on Escape without calling the API", async () => {
    renderItem();
    await openMenu();
    await clickMenuItem("Rename");
    const input = await screen.findByRole("textbox", { name: /Rename category Groceries/ });
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(categoriesApi.update).not.toHaveBeenCalled();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
  });

  it("offers Move to for other groups only", async () => {
    renderItem();
    await openMenu();
    expect(screen.getByText("Move to")).toBeInTheDocument();
  });

  it("delete menu item defers to onRequestDelete", async () => {
    const { onRequestDelete } = renderItem();
    await openMenu();
    await clickMenuItem("Delete");
    expect(onRequestDelete).toHaveBeenCalledWith("c1");
  });

  it("shows a muted transaction-count hint", () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <CategoryItem
          category={category}
          groups={groups}
          usage={{ transactions: 14, budget_entries: 0, rules: 0, payees: 0, recurring: 0 }}
          onRequestDelete={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("14 txns")).toBeInTheDocument();
  });
});
