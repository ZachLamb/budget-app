"use client";

import { useState } from "react";
import type { RentalTreatment, TaxProfile } from "@/lib/api/tax";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const OPTIONS: {
  value: RentalTreatment;
  label: string;
  blurb: string;
  consequence: string;
}[] = [
  {
    value: "schedule_e",
    label: "Rental property",
    blurb:
      "You rent the place out. You clean between guests, supply the linen, and pay the utilities — but you are not looking after people while they stay.",
    consequence: "Reported on Schedule E. No self-employment tax.",
  },
  {
    value: "schedule_c",
    label: "A business with services",
    blurb:
      "You provide substantial services to guests during the stay: daily cleaning, fresh linen mid-stay, meals, tours, a concierge.",
    consequence:
      "Reported on Schedule C. Its profit owes about 15% in self-employment tax.",
  },
];

/**
 * Which of the two a rental is decides whether its profit owes roughly
 * 15% in self-employment tax. Only the person providing the services
 * knows, so the app asks rather than picking the cheaper answer and
 * leaving a number on screen that nobody chose.
 */
export function RentalTreatmentCard({
  profile,
  onSave,
  /** Set when the projection is waiting on this answer. */
  blocking = false,
}: {
  profile: TaxProfile;
  onSave: (data: Partial<TaxProfile>) => void;
  blocking?: boolean;
}) {
  const current = profile.rental_treatment;
  const [editing, setEditing] = useState(false);

  if (current && !editing) {
    const chosen = OPTIONS.find((o) => o.value === current)!;
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Your rental</h2>
            <p className="text-sm text-muted-foreground">
              {chosen.label} — {chosen.consequence}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Change
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={blocking ? "border-amber-400" : undefined}>
      <CardContent className="space-y-4 pt-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">How is your rental run?</h2>
            {blocking && (
              <Badge variant="outline" className="text-xs">
                Needed for your estimate
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            This decides whether the rental&apos;s profit owes self-employment
            tax — both halves of Social Security and Medicare, about 15% of the
            profit. There is no safe default, so we will not guess.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onSave({ rental_treatment: o.value });
                setEditing(false);
              }}
              className={
                "rounded-lg border p-3 text-left transition hover:border-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" +
                (current === o.value ? " border-primary bg-muted/40" : "")
              }
            >
              <span className="block font-medium">{o.label}</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                {o.blurb}
              </span>
              <span className="mt-2 block text-xs font-medium">
                {o.consequence}
              </span>
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Cleaning between guests and providing linen are not &ldquo;substantial
          services&rdquo;. Looking after guests during the stay is. If yours sits
          between the two, it is worth asking someone who prepares returns —
          the difference is real money.
        </p>

        {editing && current && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
