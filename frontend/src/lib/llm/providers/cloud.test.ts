import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import api from "@/lib/api/client";
import {
  grantCloudConsent,
  hasCloudConsent,
  invalidateCloudConsentCache,
  revokeCloudConsent,
} from "./cloud";

beforeEach(() => {
  invalidateCloudConsentCache();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.delete).mockReset();
});

describe("cloud consent cache", () => {
  it("invalidates cache after grant so the next check sees the feature", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [
          {
            feature: "free_form_qa",
            tier: 4,
            revokedAt: null,
            expiresAt: null,
          },
        ],
      });
    vi.mocked(api.post).mockResolvedValue({ data: {} });

    expect(await hasCloudConsent("free_form_qa")).toBe(false);

    await grantCloudConsent("free_form_qa");

    expect(api.post).toHaveBeenCalledWith("/llm/consent", {
      feature: "free_form_qa",
      tier: 4,
    });
    expect(await hasCloudConsent("free_form_qa")).toBe(true);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("invalidates cache after revoke", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        data: [
          {
            feature: "free_form_qa",
            tier: 4,
            revokedAt: null,
            expiresAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({ data: [] });
    vi.mocked(api.delete).mockResolvedValue({ data: { ok: true } });

    expect(await hasCloudConsent("free_form_qa")).toBe(true);

    await revokeCloudConsent("free_form_qa");

    expect(await hasCloudConsent("free_form_qa")).toBe(false);
  });
});
