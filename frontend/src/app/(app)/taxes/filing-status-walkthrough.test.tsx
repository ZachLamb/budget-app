import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilingStatusWalkthrough } from "./filing-status-walkthrough";

const emptyProfile = {
  filing_status: null,
  walkthrough_answers: null,
  walkthrough_completed_at: null,
  de_minimis_election: false,
};

describe("FilingStatusWalkthrough", () => {
  it("determines Single for an unmarried filer with no dependents", async () => {
    const onSave = vi.fn();
    render(<FilingStatusWalkthrough profile={emptyProfile} onSave={onSave} />);

    await userEvent.click(screen.getByRole("radio", { name: /no.*not married/i }));
    await userEvent.click(screen.getByRole("radio", { name: /no.*just me/i }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith({
      filing_status: "single",
      walkthrough_answers: { married: false, supports_dependent: false },
    });
  });

  it("determines head of household only when every condition is met", async () => {
    const onSave = vi.fn();
    render(<FilingStatusWalkthrough profile={emptyProfile} onSave={onSave} />);

    await userEvent.click(screen.getByRole("radio", { name: /no.*not married/i }));
    await userEvent.click(screen.getByRole("radio", { name: /yes.*lives with me/i }));
    await userEvent.click(screen.getByRole("radio", { name: /yes.*more than half the costs/i }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith({
      filing_status: "head_of_household",
      walkthrough_answers: {
        married: false, supports_dependent: true, pays_over_half_home: true,
      },
    });
  });

  it("falls back to Single when the home-cost test is not met", async () => {
    const onSave = vi.fn();
    render(<FilingStatusWalkthrough profile={emptyProfile} onSave={onSave} />);

    await userEvent.click(screen.getByRole("radio", { name: /no.*not married/i }));
    await userEvent.click(screen.getByRole("radio", { name: /yes.*lives with me/i }));
    await userEvent.click(screen.getByRole("radio", { name: /no.*someone else/i }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave.mock.calls[0][0].filing_status).toBe("single");
  });

  it("explains the result rather than just naming it", async () => {
    render(<FilingStatusWalkthrough profile={emptyProfile} onSave={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: /no.*not married/i }));
    await userEvent.click(screen.getByRole("radio", { name: /no.*just me/i }));
    expect(screen.getByText(/because you/i)).toBeInTheDocument();
  });

  it("does not offer a save until every question is answered", () => {
    render(<FilingStatusWalkthrough profile={emptyProfile} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("shows the stored answers when revisited", () => {
    render(
      <FilingStatusWalkthrough
        profile={{
          ...emptyProfile,
          filing_status: "single",
          walkthrough_answers: { married: false, supports_dependent: false },
        }}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByRole("radio", { name: /no.*not married/i })).toBeChecked();
  });
  it("warns before saving a status the estimate cannot use", async () => {
    const onSave = vi.fn();
    render(
      <FilingStatusWalkthrough
        profile={emptyProfile}
        onSave={onSave}
        supportedStatuses={["single"]}
      />
    );

    await userEvent.click(screen.getByRole("radio", { name: /yes.*married/i }));

    expect(screen.getByText(/no estimate yet/i)).toBeInTheDocument();
    // Their status is a fact about them: still saveable, just explained.
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ filing_status: "married_joint" })
    );
  });

  it("says nothing extra for a supported status", async () => {
    render(
      <FilingStatusWalkthrough
        profile={emptyProfile}
        onSave={vi.fn()}
        supportedStatuses={["single"]}
      />
    );

    await userEvent.click(screen.getByRole("radio", { name: /no.*not married/i }));
    await userEvent.click(screen.getByRole("radio", { name: /no.*just me/i }));

    expect(screen.queryByText(/no estimate yet/i)).not.toBeInTheDocument();
  });

  it("shows the saved status when the answers behind it were never stored", () => {
    render(
      <FilingStatusWalkthrough
        profile={{ ...emptyProfile, filing_status: "single" }}
        onSave={vi.fn()}
        supportedStatuses={["single"]}
      />
    );

    expect(screen.getByText(/currently saved as/i)).toBeInTheDocument();
  });
});
