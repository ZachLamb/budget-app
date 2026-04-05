import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { LoginBackdrop } from "./login-backdrop";

function mockMatchMedia(opts: { reduceMotion?: boolean; compact?: boolean }) {
  const { reduceMotion = false, compact = false } = opts;
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => {
      let matches = false;
      if (query === "(prefers-reduced-motion: reduce)") matches = reduceMotion;
      if (query === "(max-width: 640px)") matches = compact;
      return {
        matches,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as MediaQueryList;
    }),
  );
}

describe("LoginBackdrop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing when reduced motion is preferred", () => {
    mockMatchMedia({ reduceMotion: true });
    const { container } = render(
      <div data-login-sky="day">
        <LoginBackdrop />
      </div>,
    );
    expect(container.querySelector(".login-backdrop")).toBeNull();
  });

  it("renders svg when motion is allowed", () => {
    mockMatchMedia({ reduceMotion: false });
    const { container } = render(
      <div data-login-sky="night">
        <LoginBackdrop />
      </div>,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector(".login-backdrop")).not.toBeNull();
  });
});
