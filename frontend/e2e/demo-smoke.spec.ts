import { test, expect } from "@playwright/test";

/**
 * Demo-mode smoke: the one path we can't afford to silently break.
 * Exercises login → dashboard → AI advisor → transactions → logout.
 *
 * Expects a running stack with `DEMO_MODE=true` on the backend and
 * `NEXT_PUBLIC_DEMO_MODE=true` on the frontend build. Locally:
 *   docker compose up -d   # with DEMO_MODE=true in .env
 *   cd frontend && npm run test:e2e
 *
 * Tolerant of timing: relies on Playwright auto-wait (`toBeVisible`,
 * `toBeEnabled`) rather than hard sleeps.
 */
test("demo happy path: login, advisor, transactions, logout", async ({ page }) => {
  // --- Login ---
  await page.goto("/login");

  // The "Try the Demo" button only renders when the frontend (or server
  // config) reports demo mode. If this assertion fails, the stack isn't
  // running in demo mode — check DEMO_MODE / NEXT_PUBLIC_DEMO_MODE.
  const demoButton = page.getByRole("button", { name: /try the demo/i });
  await expect(demoButton).toBeVisible();
  await demoButton.click();

  // --- Dashboard ---
  await expect(page).toHaveURL("/");
  // Either the dashboard heading or the welcome banner is enough to
  // confirm the authed layout rendered.
  await expect(
    page.getByRole("heading", { name: /dashboard|welcome to clarity/i }),
  ).toBeVisible();

  // --- AI advisor ---
  const openAdvisor = page.getByRole("button", { name: /open ai advisor/i });
  await expect(openAdvisor).toBeVisible();
  await openAdvisor.click();

  const advisorInput = page.getByPlaceholder(/ask about your finances/i);
  await expect(advisorInput).toBeVisible();
  await advisorInput.fill("What should I prioritize financially?");
  await advisorInput.press("Enter");

  // Advisor streams; the textarea is disabled while streaming. Wait for
  // it to come back enabled — that's the signal the round-trip finished.
  await expect(advisorInput).toBeEnabled({ timeout: 30_000 });

  // At this point the conversation should have at least one user message
  // and one assistant reply. The assistant-side bubble lives inside the
  // advisor panel dialog and carries a Bot avatar (not present on user
  // bubbles). Asserting "at least one assistant message exists" is more
  // robust than string-matching canned demo copy.
  const advisorDialog = page.getByRole("dialog", { name: /ai financial advisor/i });
  await expect(advisorDialog).toBeVisible();
  // Reply bubbles use the muted background; user bubbles use primary.
  // The class-based locator is ugly but stable against copy changes.
  const assistantBubbles = advisorDialog.locator(".bg-muted.text-foreground");
  await expect(assistantBubbles.first()).toBeVisible({ timeout: 30_000 });

  // Close the advisor so it doesn't overlap the nav on narrow viewports.
  await page.getByRole("button", { name: /close ai advisor/i }).click();

  // --- Transactions ---
  await page.goto("/transactions");
  // The page renders a <Table>; in demo mode there's seeded data, so we
  // expect at least one data row (header row isn't inside tbody).
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  expect(await rows.count()).toBeGreaterThan(0);

  // --- Logout ---
  await page.getByRole("button", { name: /^log out$/i }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: /try the demo/i })).toBeVisible();
});
