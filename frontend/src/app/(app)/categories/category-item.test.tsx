import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DndContext } from "@dnd-kit/core";
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

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: "c1", group_id: "g1", name: "Groceries", sort_order: 0,
    goal_type: "none", goal_amount: null, goal_target_date: null,
    created_at: "2026-01-01T00:00:00Z",
    deductible: false, deduction_pct: 100, tax_line: null,
    ...overrides,
  };
}

const category: Category = makeCategory();

const groups: CategoryGroup[] = [
  { id: "g1", household_id: "h1", name: "Everyday", sort_order: 0, is_income: false, created_at: "2026-01-01T00:00:00Z", categories: [category] },
  { id: "g2", household_id: "h1", name: "Bills", sort_order: 1, is_income: false, created_at: "2026-01-01T00:00:00Z", categories: [] },
];

function renderItem(onRequestDelete = vi.fn(), categoryOverride: Category = category) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <DndContext>
        <CategoryItem category={categoryOverride} groups={groups} onRequestDelete={onRequestDelete} />
      </DndContext>
    </QueryClientProvider>,
  );
  return { onRequestDelete };
}

function renderCategoryItem(categoryOverride: Category) {
  renderItem(vi.fn(), categoryOverride);
  return { user: { click: async (el: HTMLElement) => fireEvent.click(el) }, ...screen };
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

  it("toggles tax deductible and shows percent + tax line inputs", async () => {
    const cat = makeCategory({ deductible: false, deduction_pct: 100, tax_line: null });
    const { user, ...utils } = renderCategoryItem(cat);

    await user.click(utils.getByRole("button", { name: /edit/i }));
    const toggle = utils.getByRole("switch", { name: /tax deductible/i });
    await user.click(toggle);

    expect(utils.getByLabelText(/deduction %/i)).toBeInTheDocument();
    expect(utils.getByLabelText(/tax line/i)).toBeInTheDocument();
  });

  it("shows a muted transaction-count hint", () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <DndContext>
          <CategoryItem
            category={category}
            groups={groups}
            usage={{ transactions: 14, budget_entries: 0, rules: 0, payees: 0, recurring: 0 }}
            onRequestDelete={vi.fn()}
          />
        </DndContext>
      </QueryClientProvider>,
    );
    expect(screen.getByText("14 txns")).toBeInTheDocument();
  });
});
