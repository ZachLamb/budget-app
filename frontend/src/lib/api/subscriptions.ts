import api from "./client";

export type CancelGuideVerification = "official_docs" | "maintainer_curated" | "community";

export interface CancelGuideResponse {
  matched: boolean;
  merchant_key: string | null;
  display_name: string | null;
  verified_cancel_url: string | null;
  steps: string[];
  verification: CancelGuideVerification | null;
  link_is_verified: boolean;
  generic_steps: string[];
  disclaimer: string | null;
}

export const subscriptionsApi = {
  cancelGuide: (payee_name: string) =>
    api
      .get<CancelGuideResponse>("/subscriptions/cancel-guide", {
        params: { payee_name },
      })
      .then((r) => r.data),
};
