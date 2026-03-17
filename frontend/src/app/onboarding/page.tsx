"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsApi, type SimplefinClaimAccount } from "@/lib/api/settings";
import { syncApi } from "@/lib/api/sync";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, ExternalLink, Loader2, Wallet, ArrowRight, Banknote, TrendingUp, Eye } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/hooks";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const SIMPLEFIN_CREATE_URL = "https://beta-bridge.simplefin.org/simplefin/create";

type OnboardingStep = 1 | 2 | 3;

function StepIndicator({ current }: { current: OnboardingStep }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1, 2, 3].map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors",
              s < current && "bg-primary text-primary-foreground",
              s === current && "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2",
              s > current && "bg-muted text-muted-foreground"
            )}
          >
            {s < current ? <CheckCircle2 className="h-4 w-4" /> : s}
          </div>
          {s < 3 && (
            <div className={cn("h-0.5 w-12", s < current ? "bg-primary" : "bg-muted")} />
          )}
        </div>
      ))}
    </div>
  );
}

function WelcomeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div className="text-center space-y-6">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 mx-auto">
        <Wallet className="h-10 w-10 text-primary" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Welcome to Budget!</h1>
        <p className="text-muted-foreground text-lg">Let&apos;s get you set up in 2 minutes.</p>
      </div>
      <div className="text-left space-y-3 max-w-sm mx-auto">
        {[
          { icon: Banknote, text: "Connect your bank accounts" },
          { icon: ArrowRight, text: "Import your transactions automatically" },
          { icon: TrendingUp, text: "See where your money goes" },
        ].map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-3 text-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 shrink-0">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <span>{text}</span>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Button onClick={onNext} size="lg" className="w-full max-w-sm">
          Get Started <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip for now →
        </button>
      </div>
    </div>
  );
}

type SimplefinSubStep = "connect" | "paste" | "review";

function ConnectBankStep({
  onContinue,
  onSkip,
}: {
  onContinue: (accounts: SimplefinClaimAccount[]) => void;
  onSkip: () => void;
}) {
  const queryClient = useQueryClient();
  const [subStep, setSubStep] = useState<SimplefinSubStep>("connect");
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
      setSubStep("review");
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
      setSubStep("paste");
      return;
    }
    popupRef.current = popup;
    timerRef.current = setInterval(() => {
      if (popup.closed) {
        cleanup();
        setSubStep("paste");
      }
    }, 500);
  };

  const handleClaim = () => {
    if (!token.trim()) return;
    setClaimError(null);
    claimMutation.mutate(token.trim());
  };

  const handleContinue = () => {
    onContinue(claimedAccounts);
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Connect Your Bank</h2>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          SimpleFIN Bridge securely connects your bank. We get read-only access — your credentials never leave SimpleFIN&apos;s servers.
        </p>
      </div>

      {subStep === "connect" && (
        <div className="max-w-md mx-auto space-y-4">
          <Button onClick={handleOpenPopup} className="w-full" size="lg">
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
                <a href={SIMPLEFIN_CREATE_URL} target="_blank" rel="noopener noreferrer" className="underline font-medium">
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
          <Button variant="outline" className="w-full" onClick={() => setSubStep("paste")}>
            I already have a token
          </Button>
        </div>
      )}

      {subStep === "paste" && (
        <div className="max-w-md mx-auto space-y-4">
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
                {(claimError.includes("claimed") || claimError.includes("403")) && (
                  <a href={SIMPLEFIN_CREATE_URL} target="_blank" rel="noopener noreferrer" className="underline mt-1 inline-block">
                    Get a new token
                  </a>
                )}
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Don&apos;t have a token?{" "}
            <a href={SIMPLEFIN_CREATE_URL} target="_blank" rel="noopener noreferrer" className="underline">
              Open SimpleFIN Bridge
            </a>{" "}
            to get one.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setSubStep("connect"); setClaimError(null); }} className="flex-1">
              Back
            </Button>
            <Button onClick={handleClaim} disabled={!token.trim() || claimMutation.isPending} className="flex-1">
              {claimMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</>
              ) : "Connect"}
            </Button>
          </div>
        </div>
      )}

      {subStep === "review" && (
        <div className="max-w-md mx-auto space-y-4">
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold">
              Connected — {claimedAccounts.length} account{claimedAccounts.length !== 1 ? "s" : ""} found
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            These accounts will be synced. You can change account types later from the Accounts page.
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {claimedAccounts.map((acct, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="font-medium text-sm">{acct.name}</p>
                  <p className="text-xs text-muted-foreground">{acct.institution}</p>
                </div>
                <div className="text-right">
                  <Badge variant="outline" className="text-xs">{acct.account_type}</Badge>
                  <p className="text-sm font-mono mt-1">{formatCurrency(parseFloat(acct.balance))}</p>
                </div>
              </div>
            ))}
          </div>
          <Button onClick={handleContinue} className="w-full" size="lg">
            Continue <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}

      {subStep !== "review" && (
        <div className="text-center">
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now →
          </button>
        </div>
      )}
    </div>
  );
}

function AllSetStep({ onDashboard }: { onDashboard: () => void }) {
  return (
    <div className="text-center space-y-6">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-green-100 dark:bg-green-900 mx-auto">
        <CheckCircle2 className="h-10 w-10 text-green-600" />
      </div>
      <div className="space-y-2">
        <h2 className="text-3xl font-bold">You&apos;re all set!</h2>
        <p className="text-muted-foreground">
          Your accounts are connected. First sync is starting — transactions will appear shortly.
        </p>
      </div>
      <div className="flex items-center gap-2 justify-center text-sm text-muted-foreground">
        <Eye className="h-4 w-4" />
        <span>Sync is running in the background</span>
      </div>
      <Button onClick={onDashboard} size="lg" className="w-full max-w-sm">
        Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<OnboardingStep>(1);

  const handleSkip = () => {
    router.push("/");
  };

  const handleBankConnected = (accounts: SimplefinClaimAccount[]) => {
    const count = accounts.length;
    // Auto-trigger first sync
    syncApi
      .trigger()
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["syncStatus"] });
        toast.success(`Connected ${count} account${count !== 1 ? "s" : ""}. First sync started!`);
      })
      .catch(() => {
        toast.success(`Connected ${count} account${count !== 1 ? "s" : ""}. Click "Sync Now" to import transactions.`);
      });
    setStep(3);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        <StepIndicator current={step} />
        <Card>
          <CardContent className="pt-8 pb-8 px-8">
            {step === 1 && (
              <WelcomeStep
                onNext={() => setStep(2)}
                onSkip={handleSkip}
              />
            )}
            {step === 2 && (
              <ConnectBankStep
                onContinue={handleBankConnected}
                onSkip={handleSkip}
              />
            )}
            {step === 3 && (
              <AllSetStep onDashboard={() => router.push("/")} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
