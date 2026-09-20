"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PaystubInput } from "@/lib/api/tax";

type MoneyField = Exclude<keyof PaystubInput, "pay_date">;

const PAY_PERIOD_FIELDS: { key: MoneyField; label: string }[] = [
  { key: "gross", label: "Gross pay this check" },
  { key: "pretax_401k", label: "401(k) this check" },
  { key: "pretax_hsa", label: "HSA this check" },
  { key: "pretax_other", label: "Other pre-tax this check" },
  { key: "federal_withheld", label: "Federal tax held back this check" },
  { key: "state_withheld", label: "State tax held back this check" },
  { key: "ss_withheld", label: "Social Security held back this check" },
  { key: "medicare_withheld", label: "Medicare held back this check" },
];

const YTD_FIELDS: { key: MoneyField; label: string }[] = [
  { key: "gross_ytd", label: "Gross pay YTD" },
  { key: "pretax_401k_ytd", label: "401(k) YTD" },
  { key: "pretax_hsa_ytd", label: "HSA YTD" },
  { key: "pretax_other_ytd", label: "Other pre-tax YTD" },
  { key: "federal_withheld_ytd", label: "Federal tax held back YTD" },
  { key: "state_withheld_ytd", label: "State tax held back YTD" },
  { key: "ss_withheld_ytd", label: "Social Security held back YTD" },
  { key: "medicare_withheld_ytd", label: "Medicare held back YTD" },
];

const EMPTY_FORM: Record<MoneyField, string> = {
  gross: "", pretax_401k: "", pretax_hsa: "", pretax_other: "",
  federal_withheld: "", state_withheld: "", ss_withheld: "", medicare_withheld: "",
  gross_ytd: "", pretax_401k_ytd: "", pretax_hsa_ytd: "", pretax_other_ytd: "",
  federal_withheld_ytd: "", state_withheld_ytd: "", ss_withheld_ytd: "", medicare_withheld_ytd: "",
};

export function PaystubForm({
  onAdd,
}: {
  onAdd: (data: PaystubInput) => Promise<void>;
}) {
  const [payDate, setPayDate] = useState("");
  const [form, setForm] = useState<Record<MoneyField, string>>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const set = (key: MoneyField) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payDate) return;
    setSaving(true);
    try {
      const money = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v === "" ? 0 : Number(v)])
      ) as Record<MoneyField, number>;
      await onAdd({ pay_date: payDate, ...money });
      setPayDate("");
      setForm(EMPTY_FORM);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a paystub</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="pay_date">Pay date</Label>
            <Input
              id="pay_date"
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              required
            />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">This paycheck</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {PAY_PERIOD_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <Label htmlFor={key}>{label}</Label>
                  <Input
                    id={key}
                    type="number"
                    step="0.01"
                    min="0"
                    value={form[key]}
                    onChange={set(key)}
                  />
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded border p-3">
            <legend className="text-sm font-medium">
              Year-to-date (from the right-hand column of your paystub)
            </legend>
            <p className="text-xs text-muted-foreground">
              These are what the projection is built from — take a moment to
              copy them over carefully.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {YTD_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <Label htmlFor={key}>{label}</Label>
                  <Input
                    id={key}
                    type="number"
                    step="0.01"
                    min="0"
                    value={form[key]}
                    onChange={set(key)}
                  />
                </div>
              ))}
            </div>
          </fieldset>

          <Button type="submit" disabled={saving}>
            {saving ? "Adding…" : "Add paystub"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
