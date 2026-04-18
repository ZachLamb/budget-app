import "@testing-library/jest-dom/vitest";

// jsdom (as of v29) does not implement matchMedia or scrollIntoView. Our
// ThemeProvider and the AI advisor query/call them on mount, so tests that
// render them without these polyfills throw at setup.
if (typeof window !== "undefined" && !window.matchMedia) {
  // Narrow stub — jsdom's MediaQueryList interface. Handlers are no-ops;
  // tests that need specific media-query behavior should stub per-case.
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
