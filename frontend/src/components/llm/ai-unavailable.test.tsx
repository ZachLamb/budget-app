import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiUnavailable } from "./ai-unavailable";

describe("AiUnavailable", () => {
  it("renders one honest, jargon-free status message and is focusable", () => {
    render(<AiUnavailable />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("tabindex", "0");
    expect(status.textContent).toMatch(/chrome or edge on desktop/i);
    // No tier/provider jargon leaks into the UI.
    expect(status.textContent).not.toMatch(/tier|nano|web-?llm|webgpu|server/i);
  });

  it("supports a custom message", () => {
    render(<AiUnavailable message="Goal planning needs a desktop browser." />);
    expect(
      screen.getByText(/goal planning needs a desktop browser/i),
    ).toBeInTheDocument();
  });
});
