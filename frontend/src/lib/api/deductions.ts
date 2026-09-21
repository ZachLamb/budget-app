import api from "./client";

export interface DeductionLine {
  tax_line: string;
  amount: number;
  deduction_kind: string;
}

export interface DeductionsSummary {
  year: number;
  lines: DeductionLine[];
  total: number;
  estimated_tax_savings: number | null;
  suggested_withholding_reduction_per_period: number | null;
  business_total: number;
  personal_itemized_total: number;
  personal_itemized_value: number | null;
  standard_deduction: number | null;
}

// The backend serializes Decimal fields as JSON strings (e.g. "1240.00"), but
// these types declare `number`. Coerce here, once, so every caller gets real
// numbers regardless of what the wire format is.
function coerceSummary(data: DeductionsSummary): DeductionsSummary {
  return {
    ...data,
    lines: data.lines.map((line) => ({ ...line, amount: Number(line.amount) })),
    total: Number(data.total),
    estimated_tax_savings: data.estimated_tax_savings === null ? null : Number(data.estimated_tax_savings),
    suggested_withholding_reduction_per_period:
      data.suggested_withholding_reduction_per_period === null
        ? null
        : Number(data.suggested_withholding_reduction_per_period),
    business_total: Number(data.business_total ?? 0),
    personal_itemized_total: Number(data.personal_itemized_total ?? 0),
    personal_itemized_value:
      data.personal_itemized_value === null || data.personal_itemized_value === undefined
        ? null
        : Number(data.personal_itemized_value),
    standard_deduction:
      data.standard_deduction === null || data.standard_deduction === undefined
        ? null
        : Number(data.standard_deduction),
  };
}

export const deductionsApi = {
  summary: (year: number) =>
    api.get<DeductionsSummary>("/deductions/summary", { params: { year } }).then((r) => coerceSummary(r.data)),
};
