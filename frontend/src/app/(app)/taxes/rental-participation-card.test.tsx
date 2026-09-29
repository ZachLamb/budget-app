import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaxProfile } from "@/lib/api/tax";
import { RentalParticipationCard } from "./rental-participation-card";

const profile = (over: Partial<TaxProfile> = {}): TaxProfile => ({
  filing_status: "single",
  state: "CO",
  walkthrough_answers: null,
  walkthrough_completed_at: null,
  de_minimis_election: false,
  rental_treatment: "schedule_e",
  rental_active_participation: null,
  ...over,
});

describe("<RentalParticipationCard />", () => {
  it("explains why it is being asked at all", () => {
    render(<RentalParticipationCard profile={profile()} onSave={vi.fn()} />);
    expect(screen.getByText(/Your rental made a loss this year/)).toBeInTheDocument();
  });

  it("says what each answer does to the loss", () => {
    render(<RentalParticipationCard profile={profile()} onSave={vi.fn()} />);
    expect(screen.getByText(/can offset your wages, up to \$25,000/)).toBeInTheDocument();
    expect(screen.getByText(/suspended and carries forward/)).toBeInTheDocument();
  });

  it("heads off the usual misreading of 'active'", () => {
    // People assume it means doing the work themselves, and answer no.
    render(<RentalParticipationCard profile={profile()} onSave={vi.fn()} />);
    expect(
      screen.getByText(/You do not have to do the work yourself/),
    ).toBeInTheDocument();
  });

  it("saves yes", async () => {
    const onSave = vi.fn();
    render(<RentalParticipationCard profile={profile()} onSave={onSave} />);
    await userEvent.click(screen.getByText("Yes, I run it"));
    expect(onSave).toHaveBeenCalledWith({ rental_active_participation: true });
  });

  it("saves no", async () => {
    const onSave = vi.fn();
    render(<RentalParticipationCard profile={profile()} onSave={onSave} />);
    await userEvent.click(screen.getByText("No, it runs without me"));
    expect(onSave).toHaveBeenCalledWith({ rental_active_participation: false });
  });

  it("collapses once answered, and says what follows from it", () => {
    render(
      <RentalParticipationCard
        profile={profile({ rental_active_participation: true })}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByText("Do you actively run the rental?")).not.toBeInTheDocument();
    expect(screen.getByText(/your rental loss can offset wages/)).toBeInTheDocument();
  });

  it("treats a saved 'no' as answered, not as unanswered", () => {
    // `false` and `null` are different states and must not collapse.
    render(
      <RentalParticipationCard
        profile={profile({ rental_active_participation: false })}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByText("Do you actively run the rental?")).not.toBeInTheDocument();
    expect(screen.getByText(/carried forward instead of used this year/)).toBeInTheDocument();
  });
});
