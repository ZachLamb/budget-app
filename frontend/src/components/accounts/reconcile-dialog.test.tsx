import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Account, ReconciliationView } from "@/lib/api/accounts";
import { ReconcileDialog } from "./reconcile-dialog";

const view = vi.fn();
const history = vi.fn();
const reconcile = vi.fn();
const bulkUpdate = vi.fn();

vi.mock("@/lib/api/accounts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/accounts")>(
    "@/lib/api/accounts",
  );
  return {
    ...actual,
    reconciliationApi: {
      view: (...a: unknown[]) => view(...a),
      history: (...a: unknown[]) => history(...a),
      reconcile: (...a: unknown[]) => reconcile(...a),
    },
  };
});
vi.mock("@/lib/api/transactions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/transactions")>(
    "@/lib/api/transactions",
  );
  return {
    ...actual,
    transactionsApi: { bulkUpdate: (...a: unknown[]) => bulkUpdate(...a) },
  };
});
vi.mock("@/lib/hooks", () => ({
  useFlatCategories: () => ({
    allCategories: [{ id: "c1", name: "Misc", groupName: "Other" }],
    catNameMap: {},
  }),
  useIsClient: () => true,
}));

const account = { id: "a1", name: "Checking" } as Account;

const baseView = (over: Partial<ReconciliationView> = {}): ReconciliationView => ({
  account_id: "a1",
  statement_date: "2026-06-30",
  statement_balance: "1000.00",
  cleared_balance: "1000.00",
  difference: "0.00",
  cleared_count: 4,
  uncleared: [],
  last_reconciled_on: null,
  suggestions: [],
  reconciled_count: 0,
  ...over,
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <ReconcileDialog account={account} open onOpenChange={vi.fn()} />,
    { wrapper },
  );
}

async function enterBalance(value = "1000.00") {
  await userEvent.type(screen.getByLabelText("Ending balance"), value);
}

beforeEach(() => {
  view.mockReset();
  history.mockReset().mockResolvedValue([]);
  reconcile.mockReset().mockResolvedValue({ transaction_count: 4 });
  bulkUpdate.mockReset().mockResolvedValue({ updated: 1, skipped: 0 });
  view.mockResolvedValue(baseView());
});

describe("<ReconcileDialog />", () => {
  it("asks nothing until there is a figure to compare against", async () => {
    setup();
    expect(
      screen.getByText("Enter the closing balance from your statement to compare."),
    ).toBeInTheDocument();
    expect(view).not.toHaveBeenCalled();
  });

  it("says plainly that an account has never been reconciled", () => {
    // Not the same as reconciled to zero, and not something to show as
    // a blank.
    setup();
    expect(
      screen.getByText("This account has never been reconciled."),
    ).toBeInTheDocument();
  });

  it("names the date it last agreed with the bank", async () => {
    view.mockResolvedValue(baseView({ last_reconciled_on: "2026-05-31" }));
    setup();
    await enterBalance();
    await waitFor(() =>
      expect(screen.getByText(/Last balanced against a statement dated/)).toBeInTheDocument(),
    );
  });

  it("confirms a balanced account rather than leaving a bare zero", async () => {
    setup();
    await enterBalance();
    await waitFor(() =>
      expect(
        screen.getByText("This account agrees with your statement."),
      ).toBeInTheDocument(),
    );
  });

  it("will not sign off an account that does not balance", async () => {
    view.mockResolvedValue(baseView({ difference: "-50.00" }));
    setup();
    await enterBalance("950.00");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reconcile" })).toBeDisabled(),
    );
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("offers the fix where the finding is", async () => {
    // A lead you have to go and act on somewhere else is half an answer.
    view.mockResolvedValue(
      baseView({
        difference: "-50.00",
        suggestions: [
          {
            kind: "clear_one",
            explanation: "This transaction is for exactly the amount you are out by.",
            transactions: [
              { transaction_id: "t9", date: "2026-06-10", payee_name: "Shop", amount: "-50.00" },
            ],
          },
        ],
      }),
    );
    setup();
    await enterBalance("950.00");
    await waitFor(() => screen.getByText(/exactly the amount you are out by/));
    await userEvent.click(screen.getByRole("button", { name: "Clear it" }));
    expect(bulkUpdate).toHaveBeenCalledWith({
      transaction_ids: ["t9"],
      cleared: true,
    });
  });

  it("says nothing rather than inventing a lead", async () => {
    view.mockResolvedValue(baseView({ difference: "7.13", suggestions: [] }));
    setup();
    await enterBalance("1007.13");
    await waitFor(() =>
      expect(screen.getByText(/Nothing here adds up to the difference/)).toBeInTheDocument(),
    );
  });

  it("will not add a balancing entry without a category for it", async () => {
    // It is a real transaction in the ledger, not a silent correction.
    view.mockResolvedValue(baseView({ difference: "-50.00" }));
    setup();
    await enterBalance("950.00");
    await waitFor(() => screen.getByText("Or close the gap with a balancing entry"));
    expect(
      screen.getByRole("button", { name: "Add balancing entry and reconcile" }),
    ).toBeDisabled();
  });

  it("calls it a made-up figure rather than dressing it up", async () => {
    view.mockResolvedValue(baseView({ difference: "-50.00" }));
    setup();
    await enterBalance("950.00");
    await waitFor(() =>
      expect(screen.getByText(/it is a made-up figure/)).toBeInTheDocument(),
    );
  });

  it("signs off a balanced account", async () => {
    setup();
    await enterBalance();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reconcile" })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Reconcile" }));
    await waitFor(() => expect(reconcile).toHaveBeenCalled());
    // A number input normalises "1000.00" to "1000"; the server takes
    // either, so the test pins what is actually sent.
    expect(reconcile.mock.calls[0][1]).toMatchObject({
      statement_balance: "1000",
      statement_date: expect.any(String),
    });
  });

  it("shows how many rows a previous sign-off already locked", async () => {
    view.mockResolvedValue(baseView({ reconciled_count: 12 }));
    setup();
    await enterBalance();
    await waitFor(() =>
      expect(screen.getByText("12 already locked")).toBeInTheDocument(),
    );
  });
});
