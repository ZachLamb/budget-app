import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WizardProps } from "@/hooks/local-ai-setup-types";
import { LocalAiSetupWizard } from "./local-ai-setup-wizard";

function defaultProps(overrides: Partial<WizardProps> = {}): WizardProps {
  return {
    open: true,
    step: "welcome",
    setupPath: "web-llm",
    nanoStatus: "unavailable",
    modelSize: "3b",
    freeStorage: 10_000_000_000,
    progress: 0,
    verifyStatus: "idle",
    cloudAvailable: false,
    deviceUnsupported: false,
    onNext: vi.fn(),
    onCancel: vi.fn(),
    onComplete: vi.fn(),
    onRetry: vi.fn(),
    onCloudFallback: vi.fn(),
    onGrantConsent: vi.fn(),
    onToggleLite: vi.fn(),
    ...overrides,
  };
}

describe("LocalAiSetupWizard", () => {
  it("renders welcome step with privacy text", () => {
    render(<LocalAiSetupWizard {...defaultProps({ step: "welcome" })} />);

    expect(
      screen.getByRole("heading", { name: /on-device/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/budget data stays on your device/i).length).toBeGreaterThan(0);
  });

  it("renders device check with model size and free storage", () => {
    render(
      <LocalAiSetupWizard
        {...defaultProps({
          step: "device-check",
          modelSize: "3b",
          freeStorage: 5_000_000_000,
        })}
      />,
    );

    expect(screen.getByText(/1\.8 GB/)).toBeInTheDocument();
    expect(screen.getByText(/5\.0 GB/)).toBeInTheDocument();
  });

  it("disables download button when modelSize is none", () => {
    render(
      <LocalAiSetupWizard
        {...defaultProps({ step: "device-check", modelSize: "none" })}
      />,
    );

    const btn = screen.getByRole("button", { name: /download/i });
    expect(btn).toBeDisabled();
  });

  it("shows device unsupported message", () => {
    render(
      <LocalAiSetupWizard
        {...defaultProps({
          step: "device-check",
          deviceUnsupported: true,
          modelSize: "none",
        })}
      />,
    );

    expect(screen.getByText(/chrome or edge on desktop/i)).toBeInTheDocument();
  });

  it("shows progress bar during download step", () => {
    render(
      <LocalAiSetupWizard
        {...defaultProps({ step: "download", progress: 45 })}
      />,
    );

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows download error with retry button", () => {
    render(
      <LocalAiSetupWizard
        {...defaultProps({
          step: "download",
          downloadError: "Network failed",
        })}
      />,
    );

    expect(screen.getByText(/Network failed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows cloud fallback button when cloudAvailable is true", () => {
    render(
      <LocalAiSetupWizard
        {...defaultProps({ step: "welcome", cloudAvailable: true })}
      />,
    );

    expect(
      screen.getByRole("button", { name: /cloud/i }),
    ).toBeInTheDocument();
  });

  it("hides cloud fallback when cloudAvailable is false", () => {
    render(
      <LocalAiSetupWizard
        {...defaultProps({ step: "welcome", cloudAvailable: false })}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /cloud/i }),
    ).not.toBeInTheDocument();
  });

  it("renders verification success", () => {
    render(
      <LocalAiSetupWizard
        {...defaultProps({
          step: "verify",
          verifyStatus: "success",
          verifyResult: "Groceries",
        })}
      />,
    );

    expect(screen.getByText(/on-device ai is ready/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue/i }),
    ).toBeInTheDocument();
  });

  it("renders verification failure with retry", () => {
    render(
      <LocalAiSetupWizard
        {...defaultProps({ step: "verify", verifyStatus: "error" })}
      />,
    );

    expect(
      screen.getByRole("button", { name: /try again|retry/i }),
    ).toBeInTheDocument();
  });

  it("calls onCancel when dialog is closed", () => {
    const onCancel = vi.fn();
    render(<LocalAiSetupWizard {...defaultProps({ onCancel })} />);

    const closeBtn = screen.getByRole("button", { name: /close/i });
    closeBtn.click();

    expect(onCancel).toHaveBeenCalled();
  });
});
