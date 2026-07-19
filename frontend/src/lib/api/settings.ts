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
  prefer_local_server: boolean;
}

export interface LlmBackendStatus {
  configured: boolean;
  reachable: boolean;
  active_model: string | null;
  models: string[];
  /** True only when the server is loopback/private — safe to treat as on-machine. */
  is_local: boolean;
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

/** Server-recorded review signals for the current pay cycle. */
export interface CycleReviewSignals {
  observed: boolean;
  diagnosed: boolean;
  decide_ack: boolean;
}

export interface PaySchedule {
  pay_frequency: PayScheduleFrequency | null;
  pay_last_confirmed_date: string | null;
  budget_framing: string;
  cycle: PayCycleDto;
  review?: CycleReviewSignals;
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
  updateAiSettings: (ai_enabled: boolean, prefer_local_server?: boolean) =>
    api
      .put<AiSettings>("/settings/ai", {
        ai_enabled,
        ...(prefer_local_server !== undefined ? { prefer_local_server } : {}),
      })
      .then((r) => r.data),
  getLlmBackendStatus: () =>
    api.get<LlmBackendStatus>("/llm/backend-status").then((r) => r.data),
  getPlanPreferences: () =>
    api.get<PlanPreferences>("/settings/plan-preferences").then((r) => r.data),
  updatePlanPreferences: (data: { debt_strategy?: string; debt_extra_monthly?: number }) =>
    api.put<PlanPreferences>("/settings/plan-preferences", data).then((r) => r.data),

  getPaySchedule: () => api.get<PaySchedule>("/settings/pay-schedule").then((r) => r.data),

  updatePaySchedule: (data: PayScheduleUpdate) =>
    api.put<PaySchedule>("/settings/pay-schedule", data).then((r) => r.data),

  updateCycleReview: (signals: Partial<CycleReviewSignals>) =>
    api.put<PaySchedule>("/settings/cycle-review", signals).then((r) => r.data),
};
