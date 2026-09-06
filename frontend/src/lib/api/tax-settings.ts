import api from "./client";

export interface TaxSettings {
  marginal_federal_rate: number | null;
  marginal_state_rate: number | null;
  current_federal_withholding_per_period: number | null;
  remaining_pay_periods_this_year: number | null;
}

export type TaxSettingsUpdate = Partial<TaxSettings>;

export const taxSettingsApi = {
  get: () => api.get<TaxSettings>("/tax-settings").then((r) => r.data),
  update: (data: TaxSettingsUpdate) => api.put<TaxSettings>("/tax-settings", data).then((r) => r.data),
};
