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

// Node 25 ships an experimental `globalThis.localStorage` (and sessionStorage)
// stub that shadows jsdom's `Storage` implementation, leaving `window.localStorage`
// without `clear()`/`removeItem()` etc. Provide a Map-backed Storage so tests
// can read/write/clear like a real browser. Idempotent — only runs when the
// shadow is detected.
if (typeof window !== "undefined" && typeof window.localStorage?.clear !== "function") {
  const makeStorage = (): Storage => {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      clear() {
        m.clear();
      },
      getItem(key: string) {
        return m.has(key) ? m.get(key)! : null;
      },
      key(index: number) {
        return Array.from(m.keys())[index] ?? null;
      },
      removeItem(key: string) {
        m.delete(key);
      },
      setItem(key: string, value: string) {
        m.set(key, String(value));
      },
    };
  };
  Object.defineProperty(window, "localStorage", { value: makeStorage(), configurable: true });
  Object.defineProperty(window, "sessionStorage", { value: makeStorage(), configurable: true });
}
