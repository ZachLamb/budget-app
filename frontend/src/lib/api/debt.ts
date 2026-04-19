import api from "./client";

export interface DebtAccount {
  id: string;
  name: string;
  institution: string | null;
  account_type: string;
  balance: number;
  interest_rate: number | null;
  minimum_payment: number | null;
}

export interface PayoffMonthDetail {
  month: number;
  balance: number;
  interest: number;
  payment: number;
  principal: number;
}

export interface DebtPayoffResult {
  account_id: string;
  account_name: string;
  starting_balance: number;
  interest_rate: number | null;
  minimum_payment: number | null;
  months_to_payoff: number | null;
  total_interest: number;
  total_paid: number;
  payoff_date: string | null;
  schedule: PayoffMonthDetail[];
}

export interface PayoffPlanResponse {
  strategy: string;
  extra_monthly: number;
  total_months: number;
  total_interest: number;
  total_paid: number;
  debts: DebtPayoffResult[];
}

export const debtApi = {
  listDebtAccounts: () => api.get<DebtAccount[]>("/debt/accounts").then((r) => r.data),
  calculatePayoffPlan: (strategy: string, extra_monthly: number, priority_account_ids?: string[]) =>
    api
      .post<PayoffPlanResponse>("/debt/payoff-plan", {
        strategy,
        extra_monthly,
        ...(priority_account_ids?.length ? { priority_account_ids } : {}),
      })
      .then((r) => r.data),
};
