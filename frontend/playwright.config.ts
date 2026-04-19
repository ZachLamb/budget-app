import { defineConfig, devices } from "@playwright/test";

// Playwright config — smoke e2e only, chromium only, to keep CI install
// and run time minimal. Specs live in `frontend/e2e/` (kept out of `src/`
// so the vitest glob for src test files does not pick them up).
//
// baseURL is the docker-compose host port for the frontend (3001:3000).
// CI is expected to bring up the stack (see `.github/workflows/e2e.yml`)
// before running `npm run test:e2e`.
export default defineConfig({
  testDir: "./e2e",
  // No retries locally; one retry in CI to absorb the occasional cold-start
  // network hiccup without masking real regressions.
  retries: process.env.CI ? 1 : 0,
  // Serial — we only have one spec today and shared demo-user state across
  // parallel workers would be flaky anyway.
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
