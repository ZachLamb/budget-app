import api from "./client";

// The backend serializes Decimal as a JSON string ("52555.10"). These
// types declare `number`; coerce once here so no component has to think
// about the wire format.
const num = (v: string | number) => Number(v);
const maybeNum = (v: string | number | null) => (v === null ? null : Number(v));

export type FilingStatus =
  | "single" | "married_joint" | "married_separate"
  | "head_of_household" | "qualifying_surviving_spouse";

export interface QuarterlyInstallment {
  number: number;
  due_date: string;
  amount: number;
  status: "paid_or_past" | "due_next" | "upcoming";
}

export interface QuarterlyPlan {
  installments: QuarterlyInstallment[];
  /** Null means the shortfall is unknown; 0 means nothing is owed. */
  total: number | null;
  periods_past: number;
  reason: string | null;
}

export interface TaxProfile {
  filing_status: FilingStatus | null;
  /** Two-letter code. Null means unknown, never a default. */
  state: string | null;
  walkthrough_answers: Record<string, unknown> | null;
  walkthrough_completed_at: string | null;
  de_minimis_election: boolean;
  /** How the rental is reported, which decides whether its profit owes
   *  self-employment tax. Null means nobody has answered — not a
   *  default, because the two answers differ by ~15% of the profit. */
  rental_treatment: RentalTreatment | null;
  /** Whether you actively participate in the rental. Only decides
   *  whether a rental LOSS can be used against wages this year, so it is
   *  only ever asked when there is a loss. Null means unanswered. */
  rental_active_participation: boolean | null;
}

export type RentalTreatment = "schedule_e" | "schedule_c";

/** The Schedule SE breakdown, and why it came out the way it did. */
export interface SelfEmployment {
  net_profit: number;
  net_earnings: number;
  social_security: number;
  medicare: number;
  additional_medicare: number;
  total: number;
  deductible_half: number;
  reason: string;
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
  /** Null when nothing owes it — no rental, a loss, or Schedule E.
   *  Distinct from a computed zero, so the card can stay off the page. */
  self_employment: SelfEmployment | null;
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
/** Every money field arrives as a Decimal string; `reason` does not. */
type WireSelfEmployment = Record<
  Exclude<keyof SelfEmployment, "reason">,
  string
> & { reason: string };

type WireTaxProjection = Omit<
  TaxProjection,
  MoneyProjectionKey | "safe_harbor" | "explain" | "self_employment"
> &
  Record<MoneyProjectionKey, string> & {
    safe_harbor: WireSafeHarbor;
    explain: WireExplainStep[];
    self_employment: WireSelfEmployment | null;
  };

/** Rental activity recorded so far this year — deliberately not
 *  annualised. A rental's income is lumpy, so scaling a part-year figure
 *  to twelve months would invent a number and state it confidently. */
export interface RentalActuals {
  gross_rental_income: number;
  allowable_expenses: number;
  net: number;
  /** null when categories are marked but nothing is recorded yet. */
  through: string | null;
  /** false when expenses are marked but no income category is — a
   *  half-finished setup, not a rental that earned nothing. */
  has_income_category: boolean;
}

export interface ProjectionEnvelope {
  year: number;
  available: boolean;
  missing: string[];
  remaining_pay_periods: number;
  projection: TaxProjection | null;
  /** Filing statuses this year's rate tables populate. */
  supported_filing_statuses: FilingStatus[];
  quarterly?: QuarterlyPlan | null;
  /** Present only when rental categories are marked. */
  rental?: RentalActuals | null;
}

interface WireProjectionEnvelope {
  year: number;
  available: boolean;
  missing: string[];
  remaining_pay_periods: number;
  projection: WireTaxProjection | null;
  quarterly?: {
    installments: { number: number; due_date: string; amount: string | number; status: string }[];
    total: string | number | null;
    periods_past: number;
    reason: string | null;
  } | null;
  supported_filing_statuses?: FilingStatus[];
  rental?: {
    gross_rental_income: string | number;
    allowable_expenses: string | number;
    net: string | number;
    through: string | null;
    has_income_category?: boolean;
  } | null;
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

function coerceQuarterly(
  q: NonNullable<WireProjectionEnvelope["quarterly"]>,
): QuarterlyPlan {
  return {
    ...q,
    // null total means "unknown", so it must survive the coercion that
    // turns Decimal strings into numbers -- Number(null) is 0, which is
    // the other answer entirely.
    total: maybeNum(q.total),
    installments: q.installments.map((i) => ({
      ...i,
      amount: num(i.amount),
      status: i.status as QuarterlyInstallment["status"],
    })),
  };
}

function coerceProjection(p: WireTaxProjection): TaxProjection {
  const money = Object.fromEntries(
    MONEY_PROJECTION_KEYS.map((key) => [key, num(p[key])])
  ) as Record<MoneyProjectionKey, number>;
  const se = p.self_employment;
  return {
    ...money,
    // Null must survive: "nothing owes this" and "it came to zero" are
    // different answers, and only one of them should show a card.
    self_employment: se
      ? {
          net_profit: num(se.net_profit),
          net_earnings: num(se.net_earnings),
          social_security: num(se.social_security),
          medicare: num(se.medicare),
          additional_medicare: num(se.additional_medicare),
          total: num(se.total),
          deductible_half: num(se.deductible_half),
          reason: se.reason,
        }
      : null,
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

  updatePaystub: (id: string, data: PaystubInput) =>
    api.put<WirePaystub>(`/tax/paystubs/${id}`, data).then((r) => coercePaystub(r.data)),

  savePriorYear: (year: number, data: Partial<PriorYearReturn>) =>
    api.put<PriorYearReturn>(`/tax/prior-year/${year}`, data).then((r) => r.data),

  projection: (year: number) =>
    api
      .get<WireProjectionEnvelope>("/tax/projection", { params: { year } })
      .then((r) => ({
        ...r.data,
        projection: r.data.projection ? coerceProjection(r.data.projection) : null,
        supported_filing_statuses: r.data.supported_filing_statuses ?? [],
        quarterly: r.data.quarterly ? coerceQuarterly(r.data.quarterly) : null,
        rental: r.data.rental
          ? {
              gross_rental_income: num(r.data.rental.gross_rental_income),
              allowable_expenses: num(r.data.rental.allowable_expenses),
              net: num(r.data.rental.net),
              // Stays null: "marked but nothing recorded yet" is a real
              // state, and a date coerced out of null would be a lie
              // about how far the figures reach.
              through: r.data.rental.through,
              has_income_category: r.data.rental.has_income_category ?? true,
            }
          : null,
      })),

  /** Years this app has rate tables for. They are added one year at a
   *  time, by hand, so this is a list and not a range. */
  supportedYears: () =>
    api
      .get<{ supported: number[] }>("/tax/years")
      .then((r) => r.data.supported),

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

/** One filed return, in the shape tests/backtest/README.md documents. */
export interface BacktestReturn {
  year: number;
  filing_status: string;
  wages?: string;
  pretax_401k?: string;
  pretax_hsa?: string;
  federal_withheld?: string;
  state_withheld?: string;
  ss_withheld?: string;
  medicare_withheld?: string;
  actual_taxable_income?: string;
  actual_federal_income_tax?: string;
  actual_state_tax?: string;
  actual_ss_tax?: string;
  actual_medicare_tax?: string;
}

export const backtestApi = {
  /** Development only; the route 404s when a production marker is set. */
  writeFixture: (returns: BacktestReturn[]) =>
    api.post("/dev/backtest-fixture", { returns }).then(() => undefined),
};
