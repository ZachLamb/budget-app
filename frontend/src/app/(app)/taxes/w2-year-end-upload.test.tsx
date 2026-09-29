import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { W2YearEndUpload } from "./w2-year-end-upload";
import type { W2Extraction, W2Key } from "@/lib/tax-docs/w2-extract";

const extract = vi.fn();
const supportedYears = vi.fn();

vi.mock("@/lib/api/tax", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/tax")>();
  return {
    ...actual,
    taxApi: { ...actual.taxApi, supportedYears: () => supportedYears() },
  };
});

vi.mock("@/hooks/use-w2-extract", () => ({
  useW2Extract: () => ({
    extract: (...a: unknown[]) => extract(...a),
    cancel: vi.fn(),
    stage: null,
    error: null,
    clearError: vi.fn(),
    usesLocalServer: false,
    lastSource: null,
  }),
}));

/** The same realistic W-2 the derivation tests use. */
const BOXES: Partial<Record<W2Key, number>> = {
  wages: 85000,
  medicare_wages: 93000,
  ss_wages: 93000,
  pretax_401k: 8000,
  pretax_hsa: 3000,
  federal_withheld: 12000,
  state_withheld: 4092,
  ss_withheld: 5766,
  medicare_withheld: 1348.5,
};

function extraction(
  boxes: Partial<Record<W2Key, number>> = BOXES,
): W2Extraction {
  const fields = Object.fromEntries(
    Object.entries(boxes).map(([k, v]) => [
      k,
      { value: v, source_text: `${k} ${v}` },
    ]),
  );
  return { fields, dropped: [], rejections: [] } as unknown as W2Extraction;
}

async function upload() {
  const input = screen.getByLabelText("W-2 PDF") as HTMLInputElement;
  await userEvent.upload(
    input,
    new File(["%PDF-1.4"], "w2.pdf", { type: "application/pdf" }),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Render with the query provider the year list needs. */
function show(onUse = vi.fn()) {
  render(<W2YearEndUpload onUse={onUse} />, { wrapper });
  return onUse;
}

beforeEach(() => {
  extract.mockReset().mockResolvedValue(extraction());
  // Two years with rate tables, so "last year" is available by default.
  supportedYears.mockReset().mockResolvedValue([2025, 2026]);
  vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
});

describe("<W2YearEndUpload />", () => {
  it("says what it is for before anything is uploaded", () => {
    show();
    expect(screen.getByText(/A W-2 is your whole year in one page/)).toBeInTheDocument();
  });

  it("shows the year-end figures it would fill in", async () => {
    show();
    await upload();
    const heading = await screen.findByText(/What this fills in for/);
    // Scoped to the derived table: the raw boxes are listed above it and
    // carry some of the same figures.
    const derived = within(heading.parentElement!);
    // Gross is derived: 93,000 Medicare wages + 3,000 HSA.
    expect(derived.getByText("$96,000.00")).toBeInTheDocument();
    expect(derived.getByText("$12,000.00")).toBeInTheDocument();
    // ...and every row is a year-to-date total, never a single check.
    expect(derived.getByText("Gross pay (year to date)")).toBeInTheDocument();
    expect(derived.queryByText(/\(this check\)/)).not.toBeInTheDocument();
  });

  it("asks which year, and says why it asks rather than reads", async () => {
    // A whole year of figures filed against the wrong year quietly
    // spoils that year's estimate.
    show();
    await upload();
    await waitFor(() => screen.getByLabelText("Which year is this W-2 for?"));
    expect(
      screen.getByText(/filing them against the wrong year/),
    ).toBeInTheDocument();
  });

  it("defaults to last year, which is the W-2 you have in hand", async () => {
    const onUse = show();
    await upload();
    await waitFor(() => screen.getByRole("button", { name: "Use these figures" }));
    await userEvent.click(screen.getByRole("button", { name: "Use these figures" }));
    expect(onUse).toHaveBeenCalledWith(expect.anything(), "2025-12-31");
  });

  it("hands over the year-to-date figures, not per-check ones", async () => {
    // A W-2 says nothing about any single paycheck.
    const onUse = show();
    await upload();
    await waitFor(() => screen.getByRole("button", { name: "Use these figures" }));
    await userEvent.click(screen.getByRole("button", { name: "Use these figures" }));

    const [values] = onUse.mock.calls[0];
    expect(values.gross_ytd).toBe(96000);
    expect(values.federal_withheld_ytd).toBe(12000);
    expect(values.gross).toBeUndefined();
    expect(values.federal_withheld).toBeUndefined();
  });

  it("explains the derived gross rather than letting it look exact", async () => {
    show();
    await upload();
    await waitFor(() =>
      expect(screen.getByText(/Gross pay is not printed on a W-2/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/health cover/)).toBeInTheDocument();
  });

  it("offers only the years this app has rate tables for", async () => {
    // Offering a year it cannot compute lets someone enter a whole
    // year's figures and find no estimate at the end of it.
    supportedYears.mockResolvedValue([2026]);
    show();
    await upload();
    await waitFor(() => screen.getByLabelText("Which year is this W-2 for?"));
    expect(
      screen.getByText(/2025 is not available yet/),
    ).toBeInTheDocument();
  });

  it("files against a year it can compute when last year is not one", async () => {
    supportedYears.mockResolvedValue([2026]);
    const onUse = show();
    await upload();
    await waitFor(() => screen.getByRole("button", { name: "Use these figures" }));
    await userEvent.click(screen.getByRole("button", { name: "Use these figures" }));
    expect(onUse).toHaveBeenCalledWith(expect.anything(), "2026-12-31");
  });

  it("refuses when the wage boxes contradict each other", async () => {
    extract.mockResolvedValue(extraction({ ...BOXES, wages: 70000 }));
    show();
    await upload();
    await waitFor(() =>
      expect(screen.getByText(/does not come to box 5/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("$96,000.00")).not.toBeInTheDocument();
  });

  it("does not hand over figures it has refused", async () => {
    extract.mockResolvedValue(extraction({ ...BOXES, wages: 70000 }));
    const onUse = show();
    await upload();
    await waitFor(() => screen.getByRole("button", { name: "Use these figures" }));
    await userEvent.click(screen.getByRole("button", { name: "Use these figures" }));
    expect(onUse).not.toHaveBeenCalled();
  });
});
