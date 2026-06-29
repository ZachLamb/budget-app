import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AiRunStatus } from "./ai-run-status";

describe("AiRunStatus", () => {
  it("renders nothing when idle", () => {
    const { container } = render(
      <AiRunStatus progress={null} batch={null} onCancel={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows pipeline step label and cancel", () => {
    const onCancel = vi.fn();
    render(
      <AiRunStatus
        progress={{ step: "generate", label: "Drafting advice…" }}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Drafting advice…");
    fireEvent.click(screen.getByRole("button", { name: /cancel ai task/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows batch fraction in label", () => {
    render(
      <AiRunStatus
        progress={null}
        batch={{ done: 1, total: 4 }}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("batch 2 of 4");
  });
});
