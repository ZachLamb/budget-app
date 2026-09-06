import api from "./client";

export interface DeductionLine {
  tax_line: string;
  amount: number;
}

export interface DeductionsSummary {
  year: number;
  lines: DeductionLine[];
  total: number;
  estimated_tax_savings: number | null;
  suggested_withholding_reduction_per_period: number | null;
}

export const deductionsApi = {
  summary: (year: number) =>
    api.get<DeductionsSummary>("/deductions/summary", { params: { year } }).then((r) => r.data),
};
