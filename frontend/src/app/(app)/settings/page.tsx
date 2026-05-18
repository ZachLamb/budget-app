"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { syncApi } from "@/lib/api/sync";
import { authApi, credentialToJSON } from "@/lib/api/auth";
import {
  settingsApi,
  type SimplefinClaimAccount,
  type AiSettings,
  type PaySchedule,
} from "@/lib/api/settings";
import { AiSettingsCard } from "@/components/llm/ai-settings-card";
import { PrivacyDataCard } from "@/components/settings/privacy-data-card";
import { HostingHealthCard } from "@/components/settings/hosting-health-card";
import { AdminUsersCard } from "@/components/settings/admin-users-card";
import { BankSyncCard } from "@/components/settings/bank-sync-card";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { parseCreationOptions, supportsPasskey } from "@/lib/webauthn";
import { useAuth } from "@/lib/providers";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  KeyRound, Trash2, ExternalLink, Loader2, CheckCircle2, AlertCircle, Sparkles,
  CalendarDays,
} from "lucide-react";
import { useIsClient, getApiErrorMessage, useDemoGuard } from "@/lib/hooks";
import { PageHeader, QueryState, inlineErrorQueryMeta } from "@/components/page";
import {
  isSemiMonthlyPayAnchor,
  payFrequencyNeedsLastPaydate,
} from "@/lib/pay-schedule";
import { AI_COPY } from "@/lib/ai-copy";
import { toastApiError, toastPlainError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";
import { formatCurrency } from "@/lib/format";
import { SetupChecklist } from "@/components/setup-checklist";

const SIMPLEFIN_CREATE_URL = "https://beta-bridge.simplefin.org/simplefin/create";
type SetupStep = "connect" | "paste" | "review";

function SimplefinSetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<SetupStep>("connect");
  const [token, setToken] = useState("");
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [claimedAccounts, setClaimedAccounts] = useState<SimplefinClaimAccount[]>([]);
  const [claimError, setClaimError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const claimMutation = useMutation({
    mutationFn: settingsApi.claimToken,
    onSuccess: (data) => {
      setClaimedAccounts(data.accounts);
      setClaimError(null);
      setStep("review");
      queryClient.invalidateQueries({ queryKey: ["simplefinStatus"] });
    },
    onError: (err) => {
      setClaimError(getApiErrorMessage(err, "Failed to claim token. It may have already been used."));
    },
  });

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const handleOpenPopup = () => {
    setPopupBlocked(false);
    const popup = window.open(SIMPLEFIN_CREATE_URL, "simplefin", "width=820,height=720,scrollbars=yes");
    if (!popup || popup.closed) {
      setPopupBlocked(true);
      setStep("paste");
      return;
    }
    popupRef.current = popup;
    timerRef.current = setInterval(() => {
      if (popup.closed) {
        cleanup();
        setStep("paste");
      }
    }, 500);
  };

  const handleClaim = () => {
    if (!token.trim()) return;
    setClaimError(null);
    claimMutation.mutate(token.trim());
  };

  const handleClose = () => {
    cleanup();
    setStep("connect");
    setToken("");
    setClaimedAccounts([]);
    setClaimError(null);
    setPopupBlocked(false);
    onOpenChange(false);
  };

  const handleFinish = () => {
    const count = claimedAccounts.length;
    handleClose();
    // Auto-trigger first sync so the user sees data immediately
    syncApi.trigger()
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["syncStatus"] });
        appToast.success(`Connected ${count} account${count !== 1 ? "s" : ""}. First sync started — check back in a moment.`);
      })
      .catch(() => {
        appToast.success(`Connected ${count} account${count !== 1 ? "s" : ""}. Click "Sync Now" in the sidebar to import transactions.`);
      });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        {step === "connect" && (
          <>
            <DialogHeader>
              <DialogTitle>Connect your bank</DialogTitle>
              <DialogDescription>
                SimpleFIN Bridge gives this app read-only access to your accounts.
                Your bank credentials never leave SimpleFIN&apos;s servers.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <Button onClick={handleOpenPopup} className="w-full">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open SimpleFIN Bridge
              </Button>
              <div className="rounded-md bg-muted px-3 py-2.5 text-xs text-muted-foreground space-y-1">
                <p><span className="font-medium text-foreground">First time?</span> SimpleFIN will email you a sign-in link — open it in the same popup window, then connect your bank.</p>
                <p><span className="font-medium text-foreground">Already signed in?</span> The token will appear right away.</p>
                <p>Once you see your token, copy it and come back here to paste it.</p>
              </div>
              {popupBlocked && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 p-3 text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-200">Popup was blocked</p>
                  <p className="text-amber-700 dark:text-amber-300 mt-1">
                    <a
                      href={SIMPLEFIN_CREATE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-medium"
                    >
                      Click here to open SimpleFIN Bridge
                    </a>{" "}
                    in a new tab, then paste your token below.
                  </p>
                </div>
              )}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or paste token directly</span>
                </div>
              </div>
              <Button variant="outline" className="w-full" onClick={() => setStep("paste")}>
                I already have a token
              </Button>
            </div>
          </>
        )}

        {step === "paste" && (
          <>
            <DialogHeader>
              <DialogTitle>Paste your connection token</DialogTitle>
              <DialogDescription>
                After connecting your bank, SimpleFIN shows a token on screen — it&apos;s also copied to your clipboard. Paste it below.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="sfin-token">Setup token</Label>
                <Input
                  id="sfin-token"
                  type="password"
                  placeholder="Paste your base64 token here..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleClaim(); }}
                  className="font-mono text-sm"
                  autoFocus
                />
              </div>
              {claimError && (
                <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800 p-3 text-sm text-red-800 dark:text-red-200">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p>{claimError}</p>
                    {claimError.includes("claimed") || claimError.includes("403") ? (
                      <a
                        href={SIMPLEFIN_CREATE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline mt-1 inline-block"
                      >
                        Get a new token
                      </a>
                    ) : null}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Don&apos;t have a token?{" "}
                <a
                  href={SIMPLEFIN_CREATE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Open SimpleFIN Bridge
                </a>{" "}
                to get one.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setStep("connect"); setClaimError(null); }}>
                Back
              </Button>
              <Button
                onClick={handleClaim}
                disabled={!token.trim() || claimMutation.isPending}
              >
                {claimMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Connect"
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "review" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Connected &mdash; {claimedAccounts.length} account{claimedAccounts.length !== 1 ? "s" : ""} found
              </DialogTitle>
              <DialogDescription>
                These accounts will be synced. You can change account types later from the Accounts page.
                Tip: set up a passkey in SimpleFIN Bridge to skip the email step on future reconnects.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2 max-h-64 overflow-y-auto">
              {claimedAccounts.map((acct, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="font-medium text-sm">{acct.name}</p>
                    <p className="text-xs text-muted-foreground">{acct.institution}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className="text-xs">{acct.account_type}</Badge>
                    <p className="text-sm font-mono mt-1">
                      {formatCurrency(parseFloat(acct.balance))}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={handleFinish} className="w-full">
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsContent() {
  const { isDemo } = useDemoGuard();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const isClient = useIsClient();

  const {
    data: syncStatus,
    isLoading: syncStatusLoading,
    isError: syncStatusError,
    error: syncStatusErr,
    refetch: refetchSyncStatus,
  } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: syncApi.status,
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });
  const {
    data: syncHistory = [],
    isLoading: syncHistoryLoading,
    isError: syncHistoryError,
    error: syncHistoryErr,
    refetch: refetchSyncHistory,
  } = useQuery({
    queryKey: ["syncHistory"],
    queryFn: syncApi.history,
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });
  const {
    data: passkeys = [],
    isLoading: passkeysLoading,
    isError: passkeysError,
    error: passkeysErr,
    refetch: refetchPasskeys,
  } = useQuery({
    queryKey: ["passkeyCredentials"],
    queryFn: authApi.passkeyListCredentials,
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });
  const {
    data: simplefinStatus,
    isLoading: simplefinLoading,
    isError: simplefinError,
    error: simplefinErr,
    refetch: refetchSimplefin,
  } = useQuery({
    queryKey: ["simplefinStatus"],
    queryFn: settingsApi.getSimplefinStatus,
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });

  const { data: aiSettings } = useQuery({
    queryKey: ["aiSettings"],
    queryFn: settingsApi.getAiSettings,
    enabled: isClient,
  });

  const {
    data: paySchedule,
    isLoading: payScheduleLoading,
    isError: payScheduleError,
    error: payScheduleErr,
    refetch: refetchPaySchedule,
  } = useQuery({
    queryKey: ["paySchedule"],
    queryFn: settingsApi.getPaySchedule,
    enabled: isClient,
    meta: inlineErrorQueryMeta,
  });

  const [payFreqDraft, setPayFreqDraft] = useState<string>("");
  const [payLastDraft, setPayLastDraft] = useState<string>("");
  const [payLastFieldError, setPayLastFieldError] = useState<string | null>(null);
  const [framingDraft, setFramingDraft] = useState<string>("strict");

  useEffect(() => {
    if (!paySchedule) return;
    setPayFreqDraft(paySchedule.pay_frequency ?? "");
    setPayLastDraft(paySchedule.pay_last_confirmed_date ?? "");
    setFramingDraft(paySchedule.budget_framing ?? "strict");
  }, [paySchedule]);

  useEffect(() => {
    setPayLastFieldError(null);
  }, [payFreqDraft, payLastDraft]);

  const payScheduleMutation = useMutation({
    mutationFn: settingsApi.updatePaySchedule,
    onSuccess: (data: PaySchedule) => {
      queryClient.invalidateQueries({ queryKey: ["paySchedule"] });
      appToast.success("Pay schedule saved");
      setPayFreqDraft(data.pay_frequency ?? "");
      setPayLastDraft(data.pay_last_confirmed_date ?? "");
      setFramingDraft(data.budget_framing ?? "strict");
    },
    onError: (e) => toastApiError("Failed to save pay schedule", e),
  });

  const aiSettingsMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsApi.updateAiSettings(enabled),
    onSuccess: (data: AiSettings) => {
      queryClient.invalidateQueries({ queryKey: ["aiSettings"] });
      appToast.success(data.ai_enabled ? "AI enabled" : "AI disabled");
    },
    onError: (e) => toastApiError("Failed to save AI settings", e),
  });

  const aiEnabled = aiSettings?.ai_enabled ?? true;
  const isAdmin = user?.role === "admin";

  const handleRemovePasskey = async (id: string) => {
    setRemovingId(id);
    try {
      await authApi.passkeyDeleteCredential(id);
      await queryClient.invalidateQueries({ queryKey: ["passkeyCredentials"] });
      appToast.success("Passkey removed");
    } catch (e) {
      toastApiError("Failed to remove passkey", e);
    } finally {
      setRemovingId(null);
    }
  };

  const handleAddPasskey = async () => {
    setAddingPasskey(true);
    try {
      const { options } = await authApi.passkeyAddOptions();
      const optionsObj = parseCreationOptions(options);
      const createOptions: CredentialCreationOptions = optionsObj.publicKey
        ? optionsObj
        : { publicKey: optionsObj as PublicKeyCredentialCreationOptions };
      const credential = (await navigator.credentials.create(createOptions)) as PublicKeyCredential | null;
      if (!credential) {
        toastPlainError("Passkey creation was cancelled or failed");
        return;
      }
      await authApi.passkeyAddVerify(credentialToJSON(credential));
      await queryClient.invalidateQueries({ queryKey: ["passkeyCredentials"] });
      appToast.success("Passkey added");
    } catch (err: unknown) {
      toastApiError("Failed to add passkey", err);
    } finally {
      setAddingPasskey(false);
    }
  };

  const sectionSkeleton = (
    <div className="space-y-2">
      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      <div className="h-10 w-full animate-pulse rounded bg-muted" />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Account, bank sync, pay schedule, AI, and privacy — grouped below."
      />

      <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8 lg:items-start">
        <SettingsSectionNav showAdmin={isAdmin} className="mb-2 lg:mb-0" />

        <div className="space-y-6 min-w-0">
      <section id="setup" className="scroll-mt-24">
        <SetupChecklist variant="settings" />
      </section>

      <Card id="account" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Your profile. Households are single-user today—shared access is not available yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Email</span>
            <span className="text-right">{user?.email}</span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Name</span>
            <span className="text-right">{user?.name}</span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Role</span>
            <Badge variant="outline">{user?.role}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card id="security" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Sign-in (passkeys)
          </CardTitle>
          <CardDescription>
            Passkeys let you sign in without a password. Remove a passkey if you no longer have that device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState
            isLoading={passkeysLoading}
            isError={passkeysError}
            error={passkeysErr}
            onRetry={() => refetchPasskeys()}
            isEmpty={passkeys.length === 0}
            emptyDescription="No passkeys registered."
            loadingFallback={<p className="text-muted-foreground text-sm">Loading passkeys…</p>}
          >
            <ul className="space-y-2">
              {passkeys.map((pk) => (
                <li
                  key={pk.id}
                  className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    Passkey · added {new Date(pk.created_at).toLocaleDateString()}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={removingId === pk.id}
                    onClick={() => handleRemovePasskey(pk.id)}
                    aria-label="Remove passkey"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          </QueryState>
          {supportsPasskey() && !passkeysLoading && !passkeysError && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={addingPasskey}
              onClick={handleAddPasskey}
            >
              {addingPasskey ? "Adding…" : "Add passkey"}
            </Button>
          )}
        </CardContent>
      </Card>

      <BankSyncCard
        simplefinStatus={simplefinStatus}
        simplefinLoading={simplefinLoading}
        simplefinError={simplefinError}
        simplefinErr={simplefinErr}
        refetchSimplefin={refetchSimplefin}
        syncStatus={syncStatus}
        syncStatusLoading={syncStatusLoading}
        syncStatusError={syncStatusError}
        syncStatusErr={syncStatusErr}
        refetchSyncStatus={refetchSyncStatus}
        syncHistory={syncHistory}
        syncHistoryLoading={syncHistoryLoading}
        syncHistoryError={syncHistoryError}
        syncHistoryErr={syncHistoryErr}
        refetchSyncHistory={refetchSyncHistory}
        onConnectClick={() => setSetupOpen(true)}
      />

      <SimplefinSetupDialog open={setupOpen} onOpenChange={setSetupOpen} />

      <Card id="pay" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Pay schedule
          </CardTitle>
          <CardDescription>
            Anchor spending summaries to your paycheck cycle. Calendar-month budgeting on the Budget page is unchanged.
            {isDemo ? " Pay schedule changes are disabled in the demo." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <QueryState
            isLoading={payScheduleLoading}
            isError={payScheduleError}
            error={payScheduleErr}
            onRetry={() => refetchPaySchedule()}
            loadingFallback={sectionSkeleton}
          >
            {paySchedule ? (
            <>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">Current window</p>
                <p className="text-muted-foreground mt-0.5">{paySchedule.cycle.label}</p>
                {paySchedule.cycle.next_pay_date && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Next pay (expected): {new Date(paySchedule.cycle.next_pay_date + "T12:00:00").toLocaleDateString()}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay-frequency">Pay frequency</Label>
                <Select
                  value={payFreqDraft || "unset"}
                  onValueChange={(v) => setPayFreqDraft(v === "unset" ? "" : v)}
                  disabled={isDemo}
                >
                  <SelectTrigger id="pay-frequency">
                    <SelectValue placeholder="Not set (use 30-day window)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Not set</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Every two weeks</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="semimonthly">Twice monthly (15th &amp; last day)</SelectItem>
                    <SelectItem value="irregular">Irregular (30-day window)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay-last">Last payday you were paid</Label>
                <Input
                  id="pay-last"
                  type="date"
                  name="pay_last_confirmed_date"
                  autoComplete="off"
                  value={payLastDraft}
                  onChange={(e) => setPayLastDraft(e.target.value)}
                  disabled={isDemo || !payFreqDraft || payFreqDraft === "irregular"}
                  aria-invalid={payLastFieldError ? true : undefined}
                  aria-describedby={
                    payLastFieldError
                      ? "pay-last-error pay-last-hint"
                      : payFrequencyNeedsLastPaydate(payFreqDraft)
                        ? "pay-last-hint"
                        : undefined
                  }
                />
                {payLastFieldError ? (
                  <p id="pay-last-error" className="text-xs text-destructive" role="alert">
                    {payLastFieldError}
                  </p>
                ) : null}
                {payFrequencyNeedsLastPaydate(payFreqDraft) ? (
                  <p id="pay-last-hint" className="text-xs text-muted-foreground">
                    {payFreqDraft === "semimonthly"
                      ? "Pick your most recent payday. This schedule assumes pay on the 15th and the last calendar day of each month."
                      : "Required for weekly, biweekly, monthly, or twice-monthly. We roll the window forward from this date."}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget-framing">Dashboard emphasis</Label>
                <Select value={framingDraft} onValueChange={setFramingDraft} disabled={isDemo}>
                  <SelectTrigger id="budget-framing">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strict">Strict — Ready to Assign stays prominent</SelectItem>
                    <SelectItem value="reflective">Reflective — pay-period spending first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={payScheduleMutation.isPending || isDemo}
                  title={isDemo ? "Demo is read-only" : undefined}
                  onClick={() => {
                    const freq =
                      !payFreqDraft || payFreqDraft === "unset" ? null : payFreqDraft;
                    let last: string | null = null;
                    if (freq && payFrequencyNeedsLastPaydate(freq)) {
                      if (!payLastDraft.trim()) {
                        setPayLastFieldError("Choose the date of your last paycheck.");
                        toastPlainError("Choose the date of your last paycheck.");
                        return;
                      }
                      if (freq === "semimonthly" && !isSemiMonthlyPayAnchor(payLastDraft)) {
                        setPayLastFieldError(
                          "Semi-monthly pay falls on the 15th or the last day of the month — pick one of those dates.",
                        );
                        toastPlainError(
                          "Last payday must be the 15th or the last day of the month for twice-monthly pay.",
                        );
                        return;
                      }
                      last = payLastDraft;
                    }
                    payScheduleMutation.mutate({
                      pay_frequency: freq,
                      pay_last_confirmed_date: last,
                      budget_framing: framingDraft,
                    });
                  }}
                >
                  {payScheduleMutation.isPending ? "Saving…" : "Save pay schedule"}
                </Button>
              </div>
            </>
            ) : null}
          </QueryState>
        </CardContent>
      </Card>

      <section id="ai" className="scroll-mt-24 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              AI
            </CardTitle>
            <CardDescription>
              Master switch for the chat advisor and AI-powered features. Setup and cloud permissions are
              below when enabled. {AI_COPY.educationalDisclaimer}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-enabled-switch" className="text-sm font-medium">
                  Enable AI
                </Label>
                <p id="ai-enabled-hint" className="text-xs text-muted-foreground mt-0.5">
                  Saves immediately. Turns off the advisor button and all AI features app-wide.
                </p>
              </div>
              <button
                id="ai-enabled-switch"
                type="button"
                role="switch"
                aria-checked={aiEnabled}
                aria-describedby="ai-enabled-hint"
                disabled={aiSettingsMutation.isPending || isDemo}
                onClick={() => aiSettingsMutation.mutate(!aiEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 ${
                  aiEnabled ? "bg-primary" : "bg-muted-foreground/30"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    aiEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
              <p>
                <span className="font-medium text-foreground">Shared with AI:</span> Account names,
                balances, spending by category, and goals — never credentials or account numbers.
              </p>
              <p>
                <span className="font-medium text-foreground">Where it runs:</span> Prefer on-device
                models in your browser; cloud is opt-in per feature when you enable it below.
              </p>
            </div>
          </CardContent>
        </Card>
        {aiEnabled && <AiSettingsCard />}
      </section>

      <section id="privacy" className="scroll-mt-24">
        <PrivacyDataCard />
      </section>

      <section id="hosting" className="scroll-mt-24">
        <HostingHealthCard />
      </section>

      {isAdmin && (
        <section id="admin" className="scroll-mt-24">
          <AdminUsersCard />
        </section>
      )}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return <SettingsContent />;
}
