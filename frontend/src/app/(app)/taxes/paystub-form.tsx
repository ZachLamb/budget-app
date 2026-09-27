"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Paystub, PaystubInput } from "@/lib/api/tax";
import { cn } from "@/lib/utils";

type MoneyField = Exclude<keyof PaystubInput, "pay_date">;

/**
 * Sixteen money fields is what a paystub actually contains, but it is not
 * what most people need to type. Three are required (date, gross, gross
 * YTD); the pre-tax trio is zero for most filers and hides until asked
 * for. The rest are paired this-check/year-to-date so the form reads the
 * way the stub does.
 */
const PAIRS: { label: string; now: MoneyField; ytd: MoneyField; required?: boolean }[] = [
  { label: "Gross pay", now: "gross", ytd: "gross_ytd", required: true },
  { label: "Federal tax held back", now: "federal_withheld", ytd: "federal_withheld_ytd" },
  { label: "State tax held back", now: "state_withheld", ytd: "state_withheld_ytd" },
  { label: "Social Security held back", now: "ss_withheld", ytd: "ss_withheld_ytd" },
  { label: "Medicare held back", now: "medicare_withheld", ytd: "medicare_withheld_ytd" },
];

const PRETAX_PAIRS: { label: string; now: MoneyField; ytd: MoneyField }[] = [
  { label: "401(k)", now: "pretax_401k", ytd: "pretax_401k_ytd" },
  { label: "HSA", now: "pretax_hsa", ytd: "pretax_hsa_ytd" },
  { label: "Other pre-tax", now: "pretax_other", ytd: "pretax_other_ytd" },
];

const PRETAX_FIELDS: MoneyField[] = PRETAX_PAIRS.flatMap((p) => [p.now, p.ytd]);

const EMPTY_FORM: Record<MoneyField, string> = {
  gross: "", pretax_401k: "", pretax_hsa: "", pretax_other: "",
  federal_withheld: "", state_withheld: "", ss_withheld: "", medicare_withheld: "",
  gross_ytd: "", pretax_401k_ytd: "", pretax_hsa_ytd: "", pretax_other_ytd: "",
  federal_withheld_ytd: "", state_withheld_ytd: "", ss_withheld_ytd: "", medicare_withheld_ytd: "",
};

function formFrom(stub: Paystub | null): Record<MoneyField, string> {
  if (!stub) return EMPTY_FORM;
  return Object.fromEntries(
    (Object.keys(EMPTY_FORM) as MoneyField[]).map((k) => [k, String(stub[k] ?? "")])
  ) as Record<MoneyField, string>;
}

function MoneyInput({
  id, label, value, onChange, required, fromDocument,
}: {
  id: MoneyField; label: string; value: string; required?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Filled in from an uploaded stub, and not yet checked by a person. */
  fromDocument?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </Label>
      <Input
        id={id}
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        required={required}
        aria-required={required || undefined}
        value={value}
        onChange={onChange}
        className={cn(fromDocument && "border-amber-500/60")}
      />
      {fromDocument && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          Read from your document — check it.
        </p>
      )}
    </div>
  );
}

export function PaystubForm({
  onAdd,
  editing = null,
  onCancelEdit,
  prefill,
  prefillDate,
}: {
  onAdd: (data: PaystubInput) => Promise<void>;
  /**
   * When set, the form corrects this paystub instead of adding one. The
   * parent keys this component on the stub's id, so switching rows
   * remounts it with fresh values rather than resetting state in an
   * effect.
   */
  editing?: Paystub | null;
  onCancelEdit?: () => void;
  /**
   * Figures read off an uploaded stub. The parent remounts this form by
   * key when a new set arrives, so these only seed initial state.
   */
  prefill?: Partial<Record<MoneyField, number>>;
  prefillDate?: string | null;
}) {
  const [payDate, setPayDate] = useState(
    editing?.pay_date ?? prefillDate ?? "",
  );
  const [form, setForm] = useState<Record<MoneyField, string>>(() => {
    const base = formFrom(editing);
    if (!prefill) return base;
    return Object.entries(prefill).reduce(
      (acc, [key, value]) =>
        value === undefined ? acc : { ...acc, [key]: String(value) },
      base,
    );
  });
  const [saving, setSaving] = useState(false);
  // Cleared as soon as a field is touched: once you have edited it, it is
  // your figure and the note stops being true.
  const [fromDocument, setFromDocument] = useState<Set<string>>(
    () => new Set(Object.keys(prefill ?? {})),
  );
  const [showPretax, setShowPretax] = useState(
    () =>
      PRETAX_FIELDS.some((f) => Number(editing?.[f] ?? 0) > 0) ||
      PRETAX_FIELDS.some((f) => (prefill?.[f] ?? 0) > 0)
  );

  const set = (key: MoneyField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setFromDocument((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payDate || form.gross === "" || form.gross_ytd === "") return;
    setSaving(true);
    try {
      const money = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v === "" ? 0 : Number(v)])
      ) as Record<MoneyField, number>;
      await onAdd({ pay_date: payDate, ...money });
      if (!editing) {
        setPayDate("");
        setForm(EMPTY_FORM);
        setShowPretax(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {editing ? "Correct this paystub" : "Add a paystub"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Your paystub has two columns of numbers: what this one check paid,
            and the year-to-date totals beside it. Year-to-date says where you
            stand now; this check is what the rest of the year is projected
            from. Only the fields marked * are needed.
          </p>

          <div className="max-w-xs">
            <Label htmlFor="pay_date">
              Pay date<span aria-hidden="true"> *</span>
            </Label>
            <Input
              id="pay_date"
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              required
              aria-required="true"
            />
          </div>

          <div className="space-y-3">
            <div className="hidden gap-3 sm:grid sm:grid-cols-[1fr_1fr] sm:pl-[1px]">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                This check
              </span>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Year-to-date
              </span>
            </div>

            {PAIRS.map(({ label, now, ytd, required }) => (
              <div key={now} className="grid gap-3 sm:grid-cols-2">
                <MoneyInput
                  id={now}
                  label={`${label} this check`}
                  value={form[now]}
                  onChange={set(now)}
                  fromDocument={fromDocument.has(now)}
                  required={required}
                />
                <MoneyInput
                  id={ytd}
                  label={`${label} YTD`}
                  value={form[ytd]}
                  onChange={set(ytd)}
                  fromDocument={fromDocument.has(ytd)}
                  required={required}
                />
              </div>
            ))}
          </div>

          <div className="rounded border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showPretax}
                onChange={(e) => setShowPretax(e.target.checked)}
              />
              I have 401(k), HSA, or other pre-tax deductions
            </label>
            {showPretax && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  These change the answer in different directions — 401(k)
                  lowers income tax but not Social Security or Medicare, HSA
                  lowers both — so they are worth getting right.
                </p>
                {PRETAX_PAIRS.map(({ label, now, ytd }) => (
                  <div key={now} className="grid gap-3 sm:grid-cols-2">
                    <MoneyInput
                      id={now}
                      label={`${label} this check`}
                      value={form[now]}
                      onChange={set(now)}
                      fromDocument={fromDocument.has(now)}
                    />
                    <MoneyInput
                      id={ytd}
                      label={`${label} YTD`}
                      value={form[ytd]}
                      onChange={set(ytd)}
                      fromDocument={fromDocument.has(ytd)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving
                ? editing ? "Saving…" : "Adding…"
                : editing ? "Save changes" : "Add paystub"}
            </Button>
            {editing && onCancelEdit && (
              <Button type="button" variant="ghost" onClick={onCancelEdit}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
