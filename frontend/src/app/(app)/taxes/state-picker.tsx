"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { TaxProfile } from "@/lib/api/tax";

/**
 * Where you file your state return.
 *
 * Every projection used to apply Colorado's 4.4%, because the rate
 * registry took a year and nothing else. Someone in Texas saw a state tax
 * line for a state that has none, and nothing on the page suggested the
 * figure was assumed.
 */

/** States with a sourced rate table. The rest save, and say why there is
 *  no estimate, rather than borrowing a neighbour's rates. */
const WITH_RATES: Record<string, string> = {
  CO: "Colorado",
  AK: "Alaska",
  FL: "Florida",
  NH: "New Hampshire",
  NV: "Nevada",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  WA: "Washington",
  WY: "Wyoming",
};

const NO_INCOME_TAX = new Set(["AK", "FL", "NH", "NV", "SD", "TN", "TX", "WA", "WY"]);

export function StatePicker({
  profile,
  onSave,
}: {
  profile: TaxProfile;
  onSave: (data: { state: string }) => void;
}) {
  const [state, setState] = useState(profile.state ?? "");
  const known = state !== "" && state in WITH_RATES;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where you file</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          State tax is a real part of the bill, and the rates differ by
          thousands between states — so this page works out yours rather than
          assuming one.
        </p>

        <div>
          <Label htmlFor="tax-state">State</Label>
          <select
            id="tax-state"
            className="mt-1 block h-9 max-w-xs rounded-md border bg-background px-2 text-sm"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">Select your state…</option>
            {Object.entries(WITH_RATES).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
            <option value="__other">Somewhere else</option>
          </select>
        </div>

        {state === "__other" && (
          <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
            <strong>No rate table for your state yet.</strong> Only Colorado and
            the nine states with no income tax are worked out so far. The
            federal side of your estimate is unaffected, but there is no state
            figure until that table is added — and a made-up one would be worse
            than none.
          </p>
        )}

        {known && NO_INCOME_TAX.has(state) && (
          <p className="text-muted-foreground">
            {WITH_RATES[state]} has no income tax on wages, so your state tax is
            zero. That is an answer, not a missing figure.
            {state === "WA" && (
              <> Washington does tax large long-term capital gains, which this
              estimate does not cover.</>
            )}
          </p>
        )}

        <Button type="button" disabled={!known} onClick={() => onSave({ state })}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
