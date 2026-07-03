import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Transaction } from "@/lib/api/transactions";
import { ExplainCharge } from "./explain-charge";

const mockTxn: Transaction = {
  id: "txn-1",
  account_id: "acct-1",
  date: "2026-01-15",
  payee_id: null,
  payee_name: "Coffee Shop",
  amount: -4.5,
  category_id: null,
  category_name: "Dining",
  notes: null,
  cleared: true,
  reconciled: false,
  is_split: false,
  parent_transaction_id: null,
  transfer_pair_id: null,
  import_id: null,
  created_at: "2026-01-15T12:00:00Z",
};

const prepareFeatureMock = vi.fn(async () => ({ ok: false, reason: "cancelled" as const }));

vi.mock("@/lib/llm/ai-feature-gate", () => ({
  useAiFeatureGate: () => ({
    prepareFeature: prepareFeatureMock,
  }),
}));

vi.mock("@/lib/llm/useLlm", () => ({
  useLlm: () => ({
    run: vi.fn(),
  }),
}));

describe("ExplainCharge", () => {
  it("shows cancelled setup message with settings link", async () => {
    render(<ExplainCharge txn={mockTxn} />);
    fireEvent.click(screen.getByRole("button", { name: /explain this charge/i }));

    await waitFor(() => {
      expect(screen.getByText(/setup was cancelled/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /fix in ai settings/i })).toHaveAttribute(
      "href",
      "/settings#ai",
    );
    expect(prepareFeatureMock).toHaveBeenCalledWith("explain_charge");
  });
});
