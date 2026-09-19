"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FilingStatus, TaxProfile } from "@/lib/api/tax";

/**
 * Filing status is DERIVED from plain questions, never picked from a
 * list. A single filer who selects "head of household" gets a standard
 * deduction $8,050 too large -- about $2,100 of refund that does not
 * exist. This component is a correctness control.
 */

type Answers = {
  married?: boolean;
  supports_dependent?: boolean;
  pays_over_half_home?: boolean;
};

function determine(answers: Answers): FilingStatus | null {
  if (answers.married === undefined) return null;
  if (answers.married) return "married_joint";
  if (answers.supports_dependent === undefined) return null;
  if (!answers.supports_dependent) return "single";
  if (answers.pays_over_half_home === undefined) return null;
  return answers.pays_over_half_home ? "head_of_household" : "single";
}

const EXPLANATION: Record<FilingStatus, string> = {
  single: "Because you aren't married and nobody you support lives with you.",
  married_joint:
    "Because you're married. Filing separately is also possible, but it usually costs more.",
  head_of_household:
    "Because you aren't married, someone you support lives with you, and you pay more than half the cost of the home.",
  married_separate: "",
  qualifying_surviving_spouse: "",
};

const LABELS: Record<FilingStatus, string> = {
  single: "Single",
  married_joint: "Married, filing together",
  married_separate: "Married, filing separately",
  head_of_household: "Head of household",
  qualifying_surviving_spouse: "Qualifying surviving spouse",
};

function Choice({
  name, label, checked, onChange,
}: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 py-1 text-sm">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

export function FilingStatusWalkthrough({
  profile,
  onSave,
}: {
  profile: TaxProfile;
  onSave: (data: {
    filing_status: FilingStatus;
    walkthrough_answers: Record<string, unknown>;
  }) => void;
}) {
  const [answers, setAnswers] = useState<Answers>(
    (profile.walkthrough_answers as Answers) ?? {}
  );
  const status = determine(answers);

  const set = (patch: Answers) =>
    setAnswers((prev) => {
      const next = { ...prev, ...patch };
      // Dropping now-irrelevant answers keeps the stored record honest.
      if (next.married) { delete next.supports_dependent; delete next.pays_over_half_home; }
      if (next.supports_dependent === false) delete next.pays_over_half_home;
      return next;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>How you file</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A few plain questions. Getting this wrong is the most expensive
          mistake this page can make, so we work it out rather than asking
          you to pick from a list.
        </p>

        <fieldset>
          <legend className="text-sm font-medium">Are you married?</legend>
          <Choice name="married" label="No, I'm not married"
            checked={answers.married === false} onChange={() => set({ married: false })} />
          <Choice name="married" label="Yes, I'm married"
            checked={answers.married === true} onChange={() => set({ married: true })} />
        </fieldset>

        {answers.married === false && (
          <fieldset>
            <legend className="text-sm font-medium">
              Does anyone live with you that you financially support?
            </legend>
            <Choice name="dependent" label="No, it's just me"
              checked={answers.supports_dependent === false}
              onChange={() => set({ supports_dependent: false })} />
            <Choice name="dependent" label="Yes, a child or relative lives with me"
              checked={answers.supports_dependent === true}
              onChange={() => set({ supports_dependent: true })} />
          </fieldset>
        )}

        {answers.married === false && answers.supports_dependent === true && (
          <fieldset>
            <legend className="text-sm font-medium">
              Do you pay more than half the cost of keeping up your home?
            </legend>
            <Choice name="home" label="Yes, I pay more than half the costs"
              checked={answers.pays_over_half_home === true}
              onChange={() => set({ pays_over_half_home: true })} />
            <Choice name="home" label="No, someone else pays half or more"
              checked={answers.pays_over_half_home === false}
              onChange={() => set({ pays_over_half_home: false })} />
          </fieldset>
        )}

        {status && (
          <div className="rounded border p-3 text-sm">
            <p className="font-medium">You file as: {LABELS[status]}</p>
            <p className="text-muted-foreground">{EXPLANATION[status]}</p>
          </div>
        )}

        {status && (
          <Button
            onClick={() =>
              onSave({
                filing_status: status,
                walkthrough_answers: answers as Record<string, unknown>,
              })
            }
          >
            Save
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
