/**
 * Tests for the Privacy & data card.
 *
 * Focus is on the "type the phrase" guard for the delete dialog and on
 * the export filename plumbing — those are the parts with non-trivial
 * logic that have already burned us in similar destructive flows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { parseContentDispositionFilename } from "@/lib/api/me";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
}));

const logoutMock = vi.fn();
vi.mock("@/lib/providers", () => ({
  useAuth: () => ({
    user: null,
    token: "test-token",
    login: vi.fn(),
    logout: logoutMock,
    loading: false,
  }),
}));

const exportDataMock = vi.fn();
const deleteAccountMock = vi.fn();
vi.mock("@/lib/api/me", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/me")>("@/lib/api/me");
  return {
    ...actual,
    meApi: {
      exportData: () => exportDataMock(),
      deleteAccount: () => deleteAccountMock(),
    },
  };
});

const appToastSuccess = vi.fn();
vi.mock("@/lib/app-toast", () => ({
  appToast: {
    success: (...args: unknown[]) => appToastSuccess(...args),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const toastApiErrorMock = vi.fn();
vi.mock("@/lib/toast-error", () => ({
  toastApiError: (...args: unknown[]) => toastApiErrorMock(...args),
  toastErrorDiagnostic: vi.fn(),
  toastPlainError: vi.fn(),
}));

const { PrivacyDataCard } = await import("./privacy-data-card");

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PrivacyDataCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  routerPush.mockReset();
  logoutMock.mockReset();
  exportDataMock.mockReset();
  deleteAccountMock.mockReset();
  appToastSuccess.mockReset();
  toastApiErrorMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseContentDispositionFilename", () => {
  it("extracts a quoted filename", () => {
    expect(
      parseContentDispositionFilename(
        'attachment; filename="clarity-export-abc123-2026-05-10.json"',
      ),
    ).toBe("clarity-export-abc123-2026-05-10.json");
  });

  it("extracts an unquoted filename", () => {
    expect(parseContentDispositionFilename("attachment; filename=foo.json")).toBe(
      "foo.json",
    );
  });

  it("prefers RFC 5987 utf-8 encoding when present", () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename=plain.json; filename*=UTF-8''cl%C3%A1rity.json",
      ),
    ).toBe("clárity.json");
  });

  it("returns null for missing or empty headers", () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename("")).toBeNull();
    expect(parseContentDispositionFilename("inline")).toBeNull();
  });
});

describe("<PrivacyDataCard /> delete confirmation guard", () => {
  it("disables the confirm button until the phrase matches exactly", async () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /Delete my account/i }));

    const confirmBtn = await screen.findByRole("button", { name: "Delete my account" });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByLabelText(/Type/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "delete my account" } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: "Delete my account and all data" } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: "delete my account and all data" } });
    expect(confirmBtn).not.toBeDisabled();

    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it("calls deleteAccount, logs out, and routes to /login on success", async () => {
    deleteAccountMock.mockResolvedValueOnce({
      ok: true,
      deleted_user_id: "u1",
      household_deleted: true,
    });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /Delete my account/i }));
    const input = await screen.findByLabelText(/Type/);
    fireEvent.change(input, { target: { value: "delete my account and all data" } });

    const confirmBtn = screen.getByRole("button", { name: "Delete my account" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteAccountMock).toHaveBeenCalledTimes(1);
      expect(logoutMock).toHaveBeenCalledTimes(1);
      expect(routerPush).toHaveBeenCalledWith("/login");
      expect(appToastSuccess).toHaveBeenCalledWith("Account deleted.");
    });
  });

  it("does not log out or redirect on a failed delete", async () => {
    deleteAccountMock.mockRejectedValueOnce(
      Object.assign(new Error("nope"), {
        response: { status: 429, data: { detail: "Too many requests" } },
      }),
    );
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /Delete my account/i }));
    const input = await screen.findByLabelText(/Type/);
    fireEvent.change(input, { target: { value: "delete my account and all data" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));

    await waitFor(() => {
      expect(toastApiErrorMock).toHaveBeenCalled();
    });
    expect(logoutMock).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });
});

describe("<PrivacyDataCard /> export", () => {
  it("triggers a download and surfaces a success toast", async () => {
    const blob = new Blob([JSON.stringify({ ok: true })], { type: "application/json" });
    exportDataMock.mockResolvedValueOnce({
      blob,
      filename: "clarity-export-u1-2026-05-10.json",
    });

    // jsdom doesn't implement createObjectURL/revokeObjectURL.
    const createUrl = vi.fn(() => "blob:mock-url");
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createUrl, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeUrl, configurable: true });

    // Stub anchor click so jsdom doesn't try to navigate.
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Export my data/i }));

    await waitFor(() => {
      expect(exportDataMock).toHaveBeenCalledTimes(1);
      expect(createUrl).toHaveBeenCalledWith(blob);
      expect(anchorClick).toHaveBeenCalled();
      expect(appToastSuccess).toHaveBeenCalledWith("Export downloaded");
    });
  });

  it("surfaces export failures without throwing", async () => {
    exportDataMock.mockRejectedValueOnce(
      Object.assign(new Error("nope"), { response: { status: 429 } }),
    );
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Export my data/i }));
    await waitFor(() => {
      expect(toastApiErrorMock).toHaveBeenCalled();
    });
    expect(appToastSuccess).not.toHaveBeenCalled();
  });
});
