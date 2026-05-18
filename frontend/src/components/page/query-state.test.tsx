import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryState } from "./query-state";

describe("QueryState", () => {
  it("shows loading fallback when isLoading", () => {
    render(
      <QueryState
        isLoading
        isError={false}
        loadingFallback={<p>Loading…</p>}
      >
        <p>Content</p>
      </QueryState>,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("Content")).not.toBeInTheDocument();
  });

  it("shows error with retry when isError", () => {
    const onRetry = vi.fn();
    render(
      <QueryState
        isLoading={false}
        isError
        error={new Error("fail")}
        onRetry={onRetry}
        loadingFallback={<p>Loading…</p>}
      >
        <p>Content</p>
      </QueryState>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    screen.getByRole("button", { name: /retry/i }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows empty state when isEmpty", () => {
    render(
      <QueryState
        isLoading={false}
        isError={false}
        isEmpty
        emptyDescription="No items"
        loadingFallback={<p>Loading…</p>}
      >
        <p>Content</p>
      </QueryState>,
    );
    expect(screen.getByText("No items")).toBeInTheDocument();
  });

  it("renders children when ready", () => {
    render(
      <QueryState isLoading={false} isError={false} loadingFallback={<p>Loading…</p>}>
        <p>Content</p>
      </QueryState>,
    );
    expect(screen.getByText("Content")).toBeInTheDocument();
  });
});
