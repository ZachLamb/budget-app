import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaxProfile } from "@/lib/api/tax";
import { RentalTreatmentCard } from "./rental-treatment-card";

const profile = (over: Partial<TaxProfile> = {}): TaxProfile => ({
  filing_status: "single",
  state: "CO",
  walkthrough_answers: null,
  walkthrough_completed_at: null,
  de_minimis_election: false,
  rental_treatment: null,
  rental_active_participation: null,
  ...over,
});

describe("<RentalTreatmentCard />", () => {
  it("asks rather than offering a preselected answer", () => {
    // The two differ by ~15% of the profit; a default would be a number
    // nobody chose.
    render(<RentalTreatmentCard profile={profile()} onSave={vi.fn()} />);
    expect(screen.getByText("How is your rental run?")).toBeInTheDocument();
    expect(screen.getByText(/we will not guess/)).toBeInTheDocument();
  });

  it("says what each answer costs", () => {
    render(<RentalTreatmentCard profile={profile()} onSave={vi.fn()} />);
    expect(screen.getByText(/No self-employment tax/)).toBeInTheDocument();
    expect(screen.getByText(/owes about 15% in self-employment tax/)).toBeInTheDocument();
  });

  it("draws the line where the IRS draws it", () => {
    render(<RentalTreatmentCard profile={profile()} onSave={vi.fn()} />);
    expect(
      screen.getByText(/Cleaning between guests and providing linen are not/),
    ).toBeInTheDocument();
  });

  it("saves the answer that was picked", async () => {
    const onSave = vi.fn();
    render(<RentalTreatmentCard profile={profile()} onSave={onSave} />);
    await userEvent.click(screen.getByText("A business with services"));
    expect(onSave).toHaveBeenCalledWith({ rental_treatment: "schedule_c" });
  });

  it("marks itself as blocking when the estimate is waiting on it", () => {
    render(<RentalTreatmentCard profile={profile()} onSave={vi.fn()} blocking />);
    expect(screen.getByText("Needed for your estimate")).toBeInTheDocument();
  });

  it("collapses to the answer once it has one", () => {
    render(
      <RentalTreatmentCard
        profile={profile({ rental_treatment: "schedule_e" })}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByText("How is your rental run?")).not.toBeInTheDocument();
    expect(screen.getByText(/Rental property — Reported on Schedule E/)).toBeInTheDocument();
  });

  it("lets the answer be revisited", async () => {
    render(
      <RentalTreatmentCard
        profile={profile({ rental_treatment: "schedule_e" })}
        onSave={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByText("How is your rental run?")).toBeInTheDocument();
  });
});
