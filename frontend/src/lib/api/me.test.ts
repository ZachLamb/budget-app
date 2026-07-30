import { describe, it, expect, vi, afterEach } from "vitest";
import { meApi, parseContentDispositionFilename } from "./me";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseContentDispositionFilename", () => {
  it("prefers the RFC 5987 encoded form", () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename=\"fallback.json\"; filename*=UTF-8''budget%20export.json",
      ),
    ).toBe("budget export.json");
  });

  it("falls back to the plain filename when the encoded form is malformed", () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename=\"plain.json\"; filename*=UTF-8''%E0%A4%A",
      ),
    ).toBe("plain.json");
  });

  it("returns null when the header is absent", () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename("attachment")).toBeNull();
  });
});

describe("meApi request deadlines", () => {
  it("bounds the export request with a timeout signal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await meApi.exportData();

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    // Raw fetch has no default timeout — without this the dialog spins forever.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("bounds the delete request with a timeout signal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await meApi.deleteAccount();

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("raises an axios-shaped error so toastApiError can read the detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Confirmation phrase incorrect." }), {
          status: 400,
        }),
      ),
    );

    await expect(meApi.deleteAccount()).rejects.toMatchObject({
      message: "Confirmation phrase incorrect.",
      response: { status: 400, data: { detail: "Confirmation phrase incorrect." } },
    });
  });
});
