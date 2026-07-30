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
  streamCloudGenerate,
} from "./cloud";

beforeEach(() => {
  invalidateCloudConsentCache();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.delete).mockReset();
  vi.unstubAllGlobals();
});

/** Stub `fetch` with a canned SSE body. */
function stubSse(body: string, init: ResponseInit = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(body, { status: 200, ...init })),
  );
}

const params = { feature: "free_form_qa" as const, system: "s", prompt: "p" };

describe("streamCloudGenerate", () => {
  it("concatenates content frames", async () => {
    stubSse(
      [
        'data: {"content":"Hello "}',
        'data: {"content":"world"}',
        'data: {"done":true}',
        "data: [DONE]",
      ].join("\n\n"),
    );

    await expect(streamCloudGenerate(params)).resolves.toBe("Hello world");
  });

  it("keeps content collected before a malformed frame", async () => {
    stubSse(
      [
        'data: {"content":"partial answer"}',
        'data: {"content":"trunc',
        "data: [DONE]",
      ].join("\n\n"),
    );

    await expect(streamCloudGenerate(params)).resolves.toBe("partial answer");
  });

  it("surfaces an in-band error frame", async () => {
    stubSse(
      ['data: {"content":"half"}', 'data: {"error":"Cloud AI stream interrupted."}'].join(
        "\n\n",
      ),
    );

    await expect(streamCloudGenerate(params)).rejects.toThrow(
      "Cloud AI stream interrupted.",
    );
  });

  it("reports the backend detail on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Could not reach the AI backend." }), {
          status: 502,
        }),
      ),
    );

    await expect(streamCloudGenerate(params)).rejects.toThrow(
      "Could not reach the AI backend.",
    );
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 })),
    );

    await expect(streamCloudGenerate(params)).rejects.toThrow("Cloud AI is unavailable.");
  });

  it("rejects when no content frames arrived", async () => {
    stubSse("data: [DONE]");

    await expect(streamCloudGenerate(params)).rejects.toThrow(
      "Cloud model returned an empty response.",
    );
  });
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
