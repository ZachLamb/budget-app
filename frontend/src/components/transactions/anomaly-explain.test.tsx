import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnomalyFact } from "@/lib/api/ai";
import { AnomalyExplain } from "./anomaly-explain";

const runStream = vi.fn();

vi.mock("@/hooks/use-ai-pipeline-run", () => ({
  useAiPipelineRun: () => ({
    run: vi.fn(),
    runStream,
    progress: null,
    running: false,
    error: null,
    cancelled: false,
    cancel: vi.fn(),
    clearError: vi.fn(),
  }),
}));

const fact: AnomalyFact = {
  transaction_id: "t1",
  category: "Groceries",
  amount: -300,
  category_avg: 80,
  ratio: 3.75,
  date: "2026-06-15",
  payee: "Corner Store",
};

describe("AnomalyExplain", () => {
  it("renders the deterministic ratio and category from the fact (not model output)", () => {
    const { container } = render(<AnomalyExplain fact={fact} />);
    expect(container.textContent).toContain("3.8× your usual Groceries");
  });

  it("streams an explanation when the button is clicked", () => {
    render(<AnomalyExplain fact={fact} />);
    screen.getByRole("button", { name: /explain why flagged/i }).click();
    expect(runStream).toHaveBeenCalledTimes(1);
  });
});
