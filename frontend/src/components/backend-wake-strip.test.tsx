import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { BackendWakeStrip } from "./backend-wake-strip";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("BackendWakeStrip", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when the backend is already warm", async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<BackendWakeStrip probe={probe} />);

    // Never flash a loading state at users whose server is up.
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(probe).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the waking strip with progress after the threshold", async () => {
    const d = deferred<void>();
    const probe = vi.fn().mockReturnValue(d.promise);
    render(
      <BackendWakeStrip probe={probe} revealAfterMs={1500} estimateMs={30000} />,
    );

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText(/waking the server/i)).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow");
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeLessThan(100);
  });

  it("never reports 100% while the user is still waiting", async () => {
    const d = deferred<void>();
    const probe = vi.fn().mockReturnValue(d.promise);
    render(
      <BackendWakeStrip probe={probe} revealAfterMs={1500} estimateMs={10000} />,
    );

    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });

    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeLessThan(100);
  });

  it("confirms readiness, then disappears", async () => {
    const d = deferred<void>();
    const probe = vi.fn().mockReturnValue(d.promise);
    const { container } = render(
      <BackendWakeStrip probe={probe} revealAfterMs={1500} estimateMs={30000} />,
    );

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText(/waking the server/i)).toBeInTheDocument();

    await act(async () => {
      d.resolve();
      await d.promise;
    });
    await waitFor(() =>
      expect(screen.getByText(/server ready/i)).toBeInTheDocument(),
    );

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("surfaces an unreachable backend", async () => {
    const probe = vi.fn().mockRejectedValue(new Error("offline"));
    render(<BackendWakeStrip probe={probe} />);

    await waitFor(() =>
      expect(screen.getByText(/can't reach the server/i)).toBeInTheDocument(),
    );
  });

  it("exposes the wake state politely to assistive tech", async () => {
    const d = deferred<void>();
    const probe = vi.fn().mockReturnValue(d.promise);
    render(<BackendWakeStrip probe={probe} revealAfterMs={1500} />);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-label");

    // A cold start ticks for ~35s. If the seconds counter or the progress bar
    // sat inside the live region, every tick would re-announce the whole strip.
    // The region must hold only the fixed explanation.
    expect(status).not.toContainElement(screen.getByRole("progressbar"));
    expect(status.textContent).not.toMatch(/\d+s$/);
  });
});
