import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatEvidencePanel } from "./chat-evidence-panel";

describe("ChatEvidencePanel", () => {
  it("renders category spending", () => {
    render(
      <ChatEvidencePanel
        items={[
          {
            type: "category_spending",
            month: "2026-04",
            lines: [{ category: "Groceries", amount: 50 }],
          },
        ]}
      />,
    );
    expect(screen.getByTestId("chat-evidence-panel")).toBeInTheDocument();
    expect(screen.getByText(/Groceries/)).toBeInTheDocument();
  });

  it("renders goal progress", () => {
    render(
      <ChatEvidencePanel
        items={[
          {
            type: "goal_progress",
            goals: [
              {
                name: "Emergency fund",
                goal_type: "emergency_fund",
                current_amount: 5000,
                target_amount: 10000,
                pct_complete: 50,
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText(/Goal progress/)).toBeInTheDocument();
    expect(screen.getByText(/Emergency fund/)).toBeInTheDocument();
  });
});
