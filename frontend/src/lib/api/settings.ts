import api from "./client";

export interface SimplefinStatus {
  configured: boolean;
  is_access_url: boolean;
}

export interface SimplefinClaimAccount {
  name: string;
  account_type: string;
  balance: string;
  institution: string;
  available_balance: string | null;
}

export interface SimplefinClaimResponse {
  accounts: SimplefinClaimAccount[];
  institution_count: number;
}

export interface AiSettings {
  ai_enabled: boolean;
}

export interface PlanPreferences {
  debt_strategy: string | null;
  debt_extra_monthly: number | null;
}

export interface PayCycleDto {
  date_from: string;
  date_to: string;
  next_pay_date: string | null;
  label: string;
  is_fallback_30d: boolean;
}

/** Stored on the household; drives pay-cycle resolution on the server. */
export type PayScheduleFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "semimonthly"
  | "irregular";

export interface PaySchedule {
  pay_frequency: PayScheduleFrequency | null;
  pay_last_confirmed_date: string | null;
  budget_framing: string;
  cycle: PayCycleDto;
  review_step?: number;
}

export type PayScheduleUpdate = {
  pay_frequency?: string | null;
  pay_last_confirmed_date?: string | null;
  budget_framing?: string | null;
};

export const settingsApi = {
  getSimplefinStatus: () =>
    api.get<SimplefinStatus>("/settings/simplefin").then((r) => r.data),
  claimToken: (token: string) =>
    api.post<SimplefinClaimResponse>("/settings/simplefin/claim", { token }).then((r) => r.data),
  getAiSettings: () =>
    api.get<AiSettings>("/settings/ai").then((r) => r.data),
  updateAiSettings: (ai_enabled: boolean) =>
    api.put<AiSettings>("/settings/ai", { ai_enabled }).then((r) => r.data),
  getPlanPreferences: () =>
    api.get<PlanPreferences>("/settings/plan-preferences").then((r) => r.data),
  updatePlanPreferences: (data: { debt_strategy?: string; debt_extra_monthly?: number }) =>
    api.put<PlanPreferences>("/settings/plan-preferences", data).then((r) => r.data),

  getPaySchedule: () => api.get<PaySchedule>("/settings/pay-schedule").then((r) => r.data),

  updatePaySchedule: (data: PayScheduleUpdate) =>
    api.put<PaySchedule>("/settings/pay-schedule", data).then((r) => r.data),

  updateCycleReview: (step: number) =>
    api.put<PaySchedule>("/settings/cycle-review", { step }).then((r) => r.data),
};
