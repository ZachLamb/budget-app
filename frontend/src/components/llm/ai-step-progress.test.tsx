import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AiStepProgress } from "./ai-step-progress";

describe("AiStepProgress", () => {
  it("renders nothing when idle", () => {
    const { container } = render(
      <AiStepProgress progress={null} onCancel={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the current step label and a Cancel button", () => {
    const onCancel = vi.fn();
    render(
      <AiStepProgress
        progress={{ step: "generate", label: "Writing recommendations…" }}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /writing recommendations/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
