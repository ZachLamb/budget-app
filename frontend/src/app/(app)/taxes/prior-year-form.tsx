"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PriorYearReturn } from "@/lib/api/tax";

type FieldKey = Exclude<keyof PriorYearReturn, "year" | "filing_status" | "itemized">;

// agi and schedule_e_net can legitimately be negative (e.g. a rental
// loss), so they alone get no min="0".
const FIELDS: {
  key: FieldKey;
  label: string;
  note: string;
  allowNegative?: boolean;
  /** Only a filer who already knows the term will have one of these. */
  rare?: boolean;
}[] = [
  {
    key: "agi",
    label: "Adjusted gross income",
    note: "The bottom-line income figure from last year's return. Anchors this year's estimate to what you actually reported. Can be negative if you had a large loss.",
    allowNegative: true,
  },
  {
    key: "taxable_income",
    label: "Taxable income",
    note: "Income after last year's deduction — used to sanity-check this year's numbers against a real filed return.",
  },
  {
    key: "total_tax",
    label: "Total tax owed",
    note: "Last year's total tax bill. This is what the safe-harbor withholding check is measured against.",
  },
  {
    key: "total_withheld",
    label: "Total withheld",
    note: "How much was held back from your paychecks last year, so we can compare it to what you owed.",
  },
  {
    key: "itemized_amount",
    rare: true,
    label: "Itemized deduction amount",
    note: "Only needed if you itemized instead of taking the standard deduction.",
  },
  {
    key: "schedule_e_net",
    rare: true,
    label: "Rental/Schedule E net income or loss",
    note: "Net rental income or loss from last year. Can be negative — a rental loss reduces your income, and that loss can also carry forward.",
    allowNegative: true,
  },
  {
    key: "passive_loss_carryforward",
    rare: true,
    label: "Passive loss carryforward",
    note: "Rental losses from prior years that were suspended and carry into this year.",
  },
  {
    key: "capital_loss_carryforward",
    rare: true,
    label: "Capital loss carryforward",
    note: "Investment losses that exceeded the yearly limit and carry into this year.",
  },
  {
    key: "qbi_carryforward",
    rare: true,
    label: "QBI carryforward",
    note: "Any unused qualified business income deduction carrying into this year.",
  },
];

type FormState = Record<FieldKey, string>;

const EMPTY_FORM: FormState = {
  agi: "", taxable_income: "", total_tax: "", total_withheld: "",
  itemized_amount: "", schedule_e_net: "", passive_loss_carryforward: "",
  capital_loss_carryforward: "", qbi_carryforward: "",
};

function toForm(prior: PriorYearReturn | null): FormState {
  if (!prior) return EMPTY_FORM;
  return {
    agi: prior.agi?.toString() ?? "",
    taxable_income: prior.taxable_income?.toString() ?? "",
    total_tax: prior.total_tax?.toString() ?? "",
    total_withheld: prior.total_withheld?.toString() ?? "",
    itemized_amount: prior.itemized_amount?.toString() ?? "",
    schedule_e_net: prior.schedule_e_net?.toString() ?? "",
    passive_loss_carryforward: prior.passive_loss_carryforward?.toString() ?? "0",
    capital_loss_carryforward: prior.capital_loss_carryforward?.toString() ?? "0",
    qbi_carryforward: prior.qbi_carryforward?.toString() ?? "0",
  };
}

export function PriorYearForm({
  prior,
  onSave,
}: {
  prior: PriorYearReturn | null;
  onSave: (data: Partial<PriorYearReturn>) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(prior));
  const [saving, setSaving] = useState(false);
  // "QBI carryforward" next to "Total tax owed" reads as a page for
  // accountants. The four figures on the front of a 1040 are what the
  // withholding check actually needs; the rest stay folded away unless
  // this return already has one.
  const [showRare, setShowRare] = useState(() =>
    FIELDS.some((f) => f.rare && !["", "0"].includes(toForm(prior)[f.key]))
  );

  const set = (key: FieldKey) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v === "" ? null : Number(v)])
      ) as Partial<PriorYearReturn>;
      await onSave(data);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Last year&apos;s return</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Optional. It buys one thing: a check on whether enough tax is being
          held back to avoid an underpayment penalty. Everything here is on
          the first page of last year&apos;s return — leave blank what you
          don&apos;t have handy.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {FIELDS.filter((f) => !f.rare).map(({ key, label, note, allowNegative }) => (
            <div key={key}>
              <Label htmlFor={key}>{label}</Label>
              <Input
                id={key}
                className="max-w-xs"
                type="number"
                step="0.01"
                inputMode="decimal"
                min={allowNegative ? undefined : "0"}
                value={form[key]}
                onChange={set(key)}
              />
              <p className="mt-1 text-xs text-muted-foreground">{note}</p>
            </div>
          ))}

          <div className="rounded border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showRare}
                onChange={(e) => setShowRare(e.target.checked)}
              />
              I had rental income, itemized deductions, or losses carried
              forward
            </label>
            {showRare && (
              <div className="mt-3 space-y-4">
                {FIELDS.filter((f) => f.rare).map(({ key, label, note, allowNegative }) => (
                  <div key={key}>
                    <Label htmlFor={key}>{label}</Label>
                    <Input
                      id={key}
                      className="max-w-xs"
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      min={allowNegative ? undefined : "0"}
                      value={form[key]}
                      onChange={set(key)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">{note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
