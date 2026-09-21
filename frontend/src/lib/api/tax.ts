import api from "./client";

// The backend serializes Decimal as a JSON string ("52555.10"). These
// types declare `number`; coerce once here so no component has to think
// about the wire format.
const num = (v: string | number) => Number(v);
const maybeNum = (v: string | number | null) => (v === null ? null : Number(v));

export type FilingStatus =
  | "single" | "married_joint" | "married_separate"
  | "head_of_household" | "qualifying_surviving_spouse";

export interface TaxProfile {
  filing_status: FilingStatus | null;
  walkthrough_answers: Record<string, unknown> | null;
  walkthrough_completed_at: string | null;
  de_minimis_election: boolean;
}

export interface Paystub {
  id: string;
  pay_date: string;
  gross: number;
  pretax_401k: number;
  pretax_hsa: number;
  pretax_other: number;
  federal_withheld: number;
  state_withheld: number;
  ss_withheld: number;
  medicare_withheld: number;
  gross_ytd: number;
  pretax_401k_ytd: number;
  pretax_hsa_ytd: number;
  pretax_other_ytd: number;
  federal_withheld_ytd: number;
  state_withheld_ytd: number;
  ss_withheld_ytd: number;
  medicare_withheld_ytd: number;
}

export type PaystubInput = Omit<Paystub, "id">;

// The wire shape of a paystub: identical to `Paystub` except every money
// field arrives as a Decimal-serialized string rather than a number.
type WirePaystub = Omit<Paystub, MoneyPaystubKey> & Record<MoneyPaystubKey, string>;
type MoneyPaystubKey = Exclude<keyof Paystub, "id" | "pay_date">;

export interface ExplainStep { label: string; amount: number; detail: string }

export interface SafeHarbor {
  status: "met" | "not_met" | "unknown";
  test_used: string;
  required_payment: number | null;
  projected_payment: number | null;
  shortfall: number | null;
  per_period_to_close: number | null;
  reason: string;
}

export interface TaxProjection {
  agi: number;
  magi_for_pal: number;
  deduction_taken: number;
  deduction_kind: "standard" | "itemized";
  standard_deduction: number;
  itemized_total: number;
  taxable_income: number;
  federal_income_tax: number;
  social_security_tax: number;
  medicare_tax: number;
  additional_medicare_tax: number;
  state_tax: number;
  total_liability: number;
  total_withheld_projected: number;
  refund_or_amount_due: number;
  effective_rate: number;
  schedule_e_allowed_loss: number;
  schedule_e_suspended_loss: number;
  safe_harbor: SafeHarbor;
  explain: ExplainStep[];
}

// Wire shapes: the same fields, but every money value is a Decimal string
// and nullable money fields are `string | null` rather than `number | null`.
type MoneyProjectionKey = Exclude<keyof TaxProjection, "deduction_kind" | "safe_harbor" | "explain">;
type WireSafeHarbor = Omit<SafeHarbor, "required_payment" | "projected_payment" | "shortfall" | "per_period_to_close"> & {
  required_payment: string | null;
  projected_payment: string | null;
  shortfall: string | null;
  per_period_to_close: string | null;
};
type WireExplainStep = Omit<ExplainStep, "amount"> & { amount: string };
type WireTaxProjection = Omit<TaxProjection, MoneyProjectionKey | "safe_harbor" | "explain"> &
  Record<MoneyProjectionKey, string> & { safe_harbor: WireSafeHarbor; explain: WireExplainStep[] };

export interface ProjectionEnvelope {
  year: number;
  available: boolean;
  missing: string[];
  remaining_pay_periods: number;
  projection: TaxProjection | null;
  /** Filing statuses this year's rate tables populate. */
  supported_filing_statuses: FilingStatus[];
}

interface WireProjectionEnvelope {
  year: number;
  available: boolean;
  missing: string[];
  remaining_pay_periods: number;
  projection: WireTaxProjection | null;
  supported_filing_statuses?: FilingStatus[];
}

export interface PriorYearReturn {
  year: number;
  filing_status: FilingStatus | null;
  agi: number | null;
  taxable_income: number | null;
  total_tax: number | null;
  total_withheld: number | null;
  itemized: boolean;
  itemized_amount: number | null;
  schedule_e_net: number | null;
  passive_loss_carryforward: number;
  capital_loss_carryforward: number;
  qbi_carryforward: number;
}

export type ImpactKind =
  | "extra_wages" | "extra_pretax_401k" | "extra_pretax_hsa"
  | "extra_business_expense" | "extra_itemized_deduction";

export interface ImpactResult {
  kind: ImpactKind;
  change_amount: number;
  amount_of_tax: number;       // positive = more tax
  blended_rate_percent: number;
  note: string;
}

interface WireImpactResult extends Omit<ImpactResult, "change_amount" | "amount_of_tax" | "blended_rate_percent"> {
  change_amount: string;
  amount_of_tax: string;
  blended_rate_percent: string;
}

const MONEY_PROJECTION_KEYS: MoneyProjectionKey[] = [
  "agi", "magi_for_pal", "deduction_taken", "standard_deduction",
  "itemized_total", "taxable_income", "federal_income_tax",
  "social_security_tax", "medicare_tax", "additional_medicare_tax",
  "state_tax", "total_liability", "total_withheld_projected",
  "refund_or_amount_due", "effective_rate", "schedule_e_allowed_loss",
  "schedule_e_suspended_loss",
];

function coerceProjection(p: WireTaxProjection): TaxProjection {
  const money = Object.fromEntries(
    MONEY_PROJECTION_KEYS.map((key) => [key, num(p[key])])
  ) as Record<MoneyProjectionKey, number>;
  return {
    ...money,
    deduction_kind: p.deduction_kind,
    explain: p.explain.map((s) => ({ ...s, amount: num(s.amount) })),
    safe_harbor: {
      ...p.safe_harbor,
      required_payment: maybeNum(p.safe_harbor.required_payment),
      projected_payment: maybeNum(p.safe_harbor.projected_payment),
      shortfall: maybeNum(p.safe_harbor.shortfall),
      per_period_to_close: maybeNum(p.safe_harbor.per_period_to_close),
    },
  };
}

const MONEY_PAYSTUB_KEYS: MoneyPaystubKey[] = [
  "gross", "pretax_401k", "pretax_hsa", "pretax_other",
  "federal_withheld", "state_withheld", "ss_withheld", "medicare_withheld",
  "gross_ytd", "pretax_401k_ytd", "pretax_hsa_ytd", "pretax_other_ytd",
  "federal_withheld_ytd", "state_withheld_ytd", "ss_withheld_ytd", "medicare_withheld_ytd",
];

function coercePaystub(s: WirePaystub): Paystub {
  const money = Object.fromEntries(
    MONEY_PAYSTUB_KEYS.map((key) => [key, num(s[key])])
  ) as Record<MoneyPaystubKey, number>;
  return { id: s.id, pay_date: s.pay_date, ...money };
}

export const taxApi = {
  profile: () => api.get<TaxProfile>("/tax/profile").then((r) => r.data),

  saveProfile: (data: Partial<TaxProfile>) =>
    api.put<TaxProfile>("/tax/profile", data).then((r) => r.data),

  paystubs: () =>
    api.get<WirePaystub[]>("/tax/paystubs").then((r) => r.data.map(coercePaystub)),

  addPaystub: (data: PaystubInput) =>
    api.post<WirePaystub>("/tax/paystubs", data).then((r) => coercePaystub(r.data)),

  deletePaystub: (id: string) => api.delete(`/tax/paystubs/${id}`).then(() => undefined),

  priorYear: (year: number) =>
    api
      .get<PriorYearReturn>(`/tax/prior-year/${year}`)
      .then((r) => r.data)
      .catch((e: { response?: { status?: number } }) => {
        if (e.response?.status === 404) return null;
        throw e;
      }),

  savePriorYear: (year: number, data: Partial<PriorYearReturn>) =>
    api.put<PriorYearReturn>(`/tax/prior-year/${year}`, data).then((r) => r.data),

  projection: (year: number) =>
    api
      .get<WireProjectionEnvelope>("/tax/projection", { params: { year } })
      .then((r) => ({
        ...r.data,
        projection: r.data.projection ? coerceProjection(r.data.projection) : null,
        supported_filing_statuses: r.data.supported_filing_statuses ?? [],
      })),

  impact: (body: { year: number; kind: ImpactKind; amount: number }) =>
    api
      .post<WireImpactResult>("/tax/impact", { ...body, amount: String(body.amount) })
      .then((r) => ({
        ...r.data,
        change_amount: num(r.data.change_amount),
        amount_of_tax: num(r.data.amount_of_tax),
        blended_rate_percent: num(r.data.blended_rate_percent),
      })),
};
