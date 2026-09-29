"use client";

import type { TaxProfile } from "@/lib/api/tax";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Asked only when the rental made a loss.
 *
 * Active participation decides whether that loss can be set against
 * wages this year or is suspended and carried forward (IRS Pub 925).
 * On a profit it changes nothing, which is why this never appears for a
 * profitable rental — a question that cannot affect the answer is just
 * another thing to get wrong.
 */
export function RentalParticipationCard({
  profile,
  onSave,
}: {
  profile: TaxProfile;
  onSave: (data: Partial<TaxProfile>) => void;
}) {
  const answered = profile.rental_active_participation;

  if (answered !== null) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Your part in the rental</h2>
            <p className="text-sm text-muted-foreground">
              {answered
                ? "You actively participate, so your rental loss can offset wages (up to the limit)."
                : "You do not actively participate, so the loss is carried forward instead of used this year."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSave({ rental_active_participation: !answered })}
          >
            Change
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-400">
      <CardContent className="space-y-4 pt-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">
              Do you actively run the rental?
            </h2>
            <Badge variant="outline" className="text-xs">
              Needed for your estimate
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Your rental made a loss this year. Whether that loss can come off
            your wages now, or has to wait for a future year, depends on this.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onSave({ rental_active_participation: true })}
            className="rounded-lg border p-3 text-left transition hover:border-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="block font-medium">Yes, I run it</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              You make the real decisions — approving guests or tenants,
              setting the rate, arranging repairs. You do not have to do the
              work yourself, and a letting agent does not change the answer.
            </span>
            <span className="mt-2 block text-xs font-medium">
              The loss can offset your wages, up to $25,000 and less as your
              income rises past $100,000.
            </span>
          </button>
          <button
            type="button"
            onClick={() => onSave({ rental_active_participation: false })}
            className="rounded-lg border p-3 text-left transition hover:border-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="block font-medium">No, it runs without me</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Someone else makes the decisions, or your stake is small enough
              that you have no real say.
            </span>
            <span className="mt-2 block text-xs font-medium">
              The loss is suspended and carries forward to a year the rental
              makes money.
            </span>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
