import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RulePreview } from "@/lib/api/rules";
import { RuleMatchList, MatchCountBadge } from "./rule-match-list";

const match = (over: Partial<RulePreview["sample"][number]> = {}) => ({
  transaction_id: "t1",
  date: "2026-06-04",
  payee_name: "Blue Bottle Coffee",
  amount: "-4.50",
  matched_on: "Blue Bottle Coffee",
  rule_id: "r1",
  category_id: "c1",
  ...over,
});

describe("<RuleMatchList />", () => {
  it("says a rule catches nothing instead of showing an empty list", () => {
    render(<RuleMatchList preview={{ total: 0, sample: [] }} />);
    expect(screen.getByText("Nothing matches yet.")).toBeInTheDocument();
  });

  it("counts what would change", () => {
    render(<RuleMatchList preview={{ total: 5, sample: [match()] }} />);
    expect(
      screen.getByText("5 uncategorized transactions would be categorized"),
    ).toBeInTheDocument();
  });

  it("gets the singular right", () => {
    render(<RuleMatchList preview={{ total: 1, sample: [match()] }} />);
    expect(
      screen.getByText("1 uncategorized transaction would be categorized"),
    ).toBeInTheDocument();
  });

  it("says how many rows it is not showing", () => {
    render(
      <RuleMatchList preview={{ total: 47, sample: [match(), match({ transaction_id: "t2" })] }} />,
    );
    expect(screen.getByText(/and 45 more/)).toBeInTheDocument();
  });

  it("highlights where a literal pattern hit", () => {
    // A count says whether a pattern is too broad; seeing where it hit
    // says whether it is the right kind of broad.
    render(
      <RuleMatchList preview={{ total: 1, sample: [match()] }} needle="bottle" />,
    );
    const mark = screen.getByText("Bottle");
    expect(mark.tagName).toBe("MARK");
  });

  it("leaves text alone when the pattern is not a literal", () => {
    const { container } = render(
      <RuleMatchList preview={{ total: 1, sample: [match()] }} needle="" />,
    );
    expect(container.querySelector("mark")).toBeNull();
  });

  it("always says that a chosen category is safe", () => {
    render(<RuleMatchList preview={{ total: 3, sample: [match()] }} />);
    expect(
      screen.getByText(/a category you chose yourself is never overwritten/i),
    ).toBeInTheDocument();
  });
});

describe("<MatchCountBadge />", () => {
  it("shows nothing before there is a question to answer", () => {
    const { container } = render(
      <MatchCountBadge preview={undefined} isFetching={false} error={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says it is working while the answer is in flight", () => {
    render(<MatchCountBadge preview={undefined} isFetching error={null} />);
    expect(screen.getByText("Checking…")).toBeInTheDocument();
  });

  it("distinguishes no matches from no answer", () => {
    render(
      <MatchCountBadge preview={{ total: 0, sample: [] }} isFetching={false} error={null} />,
    );
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("reports a rejected pattern rather than a count of zero", () => {
    // A pattern the server refused has no match count; showing "0
    // matches" would read as "this rule is simply too narrow".
    render(
      <MatchCountBadge
        preview={{ total: 0, sample: [] }}
        isFetching={false}
        error={new Error("bad regex")}
      />,
    );
    expect(screen.getByText(/Can't check this pattern/)).toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  it("keeps the last count visible while a new one loads", () => {
    render(
      <MatchCountBadge preview={{ total: 7, sample: [] }} isFetching error={null} />,
    );
    expect(screen.getByText("7 matches")).toBeInTheDocument();
  });
});
