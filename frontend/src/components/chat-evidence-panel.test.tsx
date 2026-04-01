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
});
