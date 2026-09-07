import api from "./client";

export interface TaxSettings {
  marginal_federal_rate: number | null;
  marginal_state_rate: number | null;
  current_federal_withholding_per_period: number | null;
  remaining_pay_periods_this_year: number | null;
}

export type TaxSettingsUpdate = Partial<TaxSettings>;

// The backend serializes Decimal fields as JSON strings (e.g. "22.00"), but
// these types declare `number`. Coerce here, once, so every caller gets real
// numbers regardless of what the wire format is.
function coerce(data: TaxSettings): TaxSettings {
  return {
    marginal_federal_rate: data.marginal_federal_rate === null ? null : Number(data.marginal_federal_rate),
    marginal_state_rate: data.marginal_state_rate === null ? null : Number(data.marginal_state_rate),
    current_federal_withholding_per_period:
      data.current_federal_withholding_per_period === null ? null : Number(data.current_federal_withholding_per_period),
    remaining_pay_periods_this_year:
      data.remaining_pay_periods_this_year === null ? null : Number(data.remaining_pay_periods_this_year),
  };
}

export const taxSettingsApi = {
  get: () => api.get<TaxSettings>("/tax-settings").then((r) => coerce(r.data)),
  update: (data: TaxSettingsUpdate) => api.put<TaxSettings>("/tax-settings", data).then((r) => coerce(r.data)),
};
