"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { TaxSettings, TaxSettingsUpdate } from "@/lib/api/tax-settings";

export function TaxSettingsCard({
  settings,
  onSave,
}: {
  settings: TaxSettings;
  onSave: (data: TaxSettingsUpdate) => Promise<void>;
}) {
  const [form, setForm] = useState({
    marginal_federal_rate: settings.marginal_federal_rate?.toString() ?? "",
    marginal_state_rate: settings.marginal_state_rate?.toString() ?? "",
    current_federal_withholding_per_period: settings.current_federal_withholding_per_period?.toString() ?? "",
    remaining_pay_periods_this_year: settings.remaining_pay_periods_this_year?.toString() ?? "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        marginal_federal_rate: form.marginal_federal_rate === "" ? null : Number(form.marginal_federal_rate),
        marginal_state_rate: form.marginal_state_rate === "" ? null : Number(form.marginal_state_rate),
        current_federal_withholding_per_period:
          form.current_federal_withholding_per_period === "" ? null : Number(form.current_federal_withholding_per_period),
        remaining_pay_periods_this_year:
          form.remaining_pay_periods_this_year === "" ? null : Number(form.remaining_pay_periods_this_year),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="marginal_federal_rate">Marginal federal rate (%)</Label>
            <Input
              id="marginal_federal_rate"
              type="number"
              value={form.marginal_federal_rate}
              onChange={(e) => setForm((f) => ({ ...f, marginal_federal_rate: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="marginal_state_rate">Marginal state rate (%)</Label>
            <Input
              id="marginal_state_rate"
              type="number"
              value={form.marginal_state_rate}
              onChange={(e) => setForm((f) => ({ ...f, marginal_state_rate: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="current_federal_withholding_per_period">Current federal withholding per paycheck</Label>
            <Input
              id="current_federal_withholding_per_period"
              type="number"
              value={form.current_federal_withholding_per_period}
              onChange={(e) => setForm((f) => ({ ...f, current_federal_withholding_per_period: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="remaining_pay_periods_this_year">Remaining paychecks this year</Label>
            <Input
              id="remaining_pay_periods_this_year"
              type="number"
              value={form.remaining_pay_periods_this_year}
              onChange={(e) => setForm((f) => ({ ...f, remaining_pay_periods_this_year: e.target.value }))}
            />
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
