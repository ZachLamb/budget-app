/**
 * ErrorBoundary retry-limit behavior.
 *
 * Before Phase 2, "Try again" reset the fallback state and immediately
 * re-rendered the same subtree — if the child's failure cause was stable
 * (bad localStorage, missing API key, etc.) the user just saw the same
 * error flash repeatedly. After Phase 2, the retry button disappears
 * after MAX_RETRIES and the copy nudges a full reload.
 */
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./error-boundary";

/** Child that throws on the first N renders, then renders "ok". */
function BoomThenOk({ times }: { times: number }) {
  const [rendered] = useState(0);
  if (rendered < times) {
    throw new Error("boom");
  }
  return <div>ok</div>;
}

/** Child that throws every render (stable failure). */
function AlwaysBoom() {
  throw new Error("stable failure");
}

describe("ErrorBoundary retry limit", () => {
  it("shows the Try again button on the first failure", () => {
    render(
      <ErrorBoundary>
        <AlwaysBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeEnabled();
  });

  it("hides Try again after two failed retries and pushes Reload instead", () => {
    render(
      <ErrorBoundary>
        <AlwaysBoom />
      </ErrorBoundary>,
    );

    // 1st and 2nd retries still show the button.
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));

    // After two retries against a stable failure, the button should be gone
    // and the copy should recommend a reload.
    expect(screen.queryByRole("button", { name: /Try again/i })).toBeNull();
    expect(screen.getByText(/keeps failing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reload page/i })).toBeInTheDocument();
  });
});

describe("ErrorBoundary initial state", () => {
  it("renders the children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <BoomThenOk times={0} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
