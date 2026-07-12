"use client";

import { Suspense, useState, useEffect, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/providers";
import { authApi, credentialToJSON } from "@/lib/api/auth";
import { parseCreationOptions, parseRequestOptions, supportsPasskey } from "@/lib/webauthn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Wallet, KeyRound, Play, Mail, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { toastApiError, toastPlainError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";
import { passkeyRegisterErrorAction } from "@/lib/passkey-register-error";
import { useDemoGuard } from "@/lib/hooks";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Google sign-in was cancelled or denied.",
  missing_params: "Missing response from Google. Please try again.",
  invalid_state: "Invalid state. Please try again.",
  token_failed: "Could not sign in with Google. Please try again.",
  userinfo_failed: "Could not load your Google profile. Please try again.",
  invalid_profile: "Google did not provide required profile information.",
  server_error: "Sign-in is temporarily unavailable. Please try again in a moment.",
  demo_oauth_disabled: 'Google sign-in is turned off for the demo. Use "Try the Demo" or email sign-in.',
  demo_oauth_signup_disabled: 'New Google accounts cannot be created in the demo. Use "Try the Demo" or an account that already exists on this server.',
};

function Divider({ label }: { label: string }) {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-card px-2 text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function LoginPageContent() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [magicLinkSending, setMagicLinkSending] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [moreOptionsToggled, setMoreOptionsToggled] = useState(false);

  const canUsePasskey = useSyncExternalStore(
    () => () => {},
    supportsPasskey,
    () => false,
  );

  // Expand "more options" if user clicked toggle OR passkeys aren't available
  const moreOptionsOpen = moreOptionsToggled || !canUsePasskey;

  const { serverDemoMode: isDemo } = useDemoGuard();
  const { user, loading: authLoading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawNext = searchParams.get("next") || "/";
  const nextPath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  useEffect(() => {
    if (!authLoading && user?.status === "approved") {
      router.replace(nextPath);
    }
  }, [authLoading, user, router, nextPath]);

  useEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      toastPlainError(ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again.");
      router.replace("/login", { scroll: false });
    }
  }, [searchParams, router]);

  const handleDemoLogin = async () => {
    setDemoLoading(true);
    try {
      const result = await authApi.demoLogin();
      login(result.user);
      router.push(nextPath);
    } catch (e) {
      toastApiError("Demo login failed. Is the backend running in demo mode?", e);
    } finally {
      setDemoLoading(false);
    }
  };

  const handleMagicLinkRequest = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setMagicLinkSending(true);
    try {
      await authApi.magicLinkRequest(trimmed);
    } catch {
      // Swallow — anti-enumeration: always show success UX.
    } finally {
      setMagicLinkSending(false);
      setMagicLinkSent(true);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegister || !password) return;
    setLoading(true);
    try {
      const result = await authApi.login({ email, password });
      login(result.user);
      router.push(nextPath);
    } catch (e) {
      toastApiError("Invalid credentials", e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWithPasskey = async () => {
    if (!name.trim() || !email.trim()) {
      toastPlainError("Please enter your name and email");
      return;
    }
    setLoading(true);
    try {
      const { options } = await authApi.passkeyRegisterOptions({
        email: email.trim(),
        name: name.trim(),
        household_name: "My Household",
      });
      const optionsObj = parseCreationOptions(options);
      const createOptions: CredentialCreationOptions = optionsObj.publicKey
        ? optionsObj
        : { publicKey: optionsObj as PublicKeyCredentialCreationOptions };
      const credential = (await navigator.credentials.create(createOptions)) as PublicKeyCredential | null;
      if (!credential) {
        toastPlainError("Passkey creation was cancelled or failed");
        return;
      }
      try {
        const result = await authApi.passkeyRegisterVerify(credentialToJSON(credential));
        login(result.user);
        router.push("/onboarding");
      } catch (verifyErr: unknown) {
        const action = passkeyRegisterErrorAction(verifyErr);
        if (action.kind === "approval-gate") {
          appToast.info(action.detail);
          router.push("/pending-approval");
          return;
        }
        throw verifyErr;
      }
    } catch (err: unknown) {
      toastApiError("Passkey registration failed", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSignInWithPasskey = async () => {
    setLoading(true);
    try {
      const { options } = await authApi.passkeyAuthenticateOptions({ email: email.trim() || undefined });
      const optionsObj = parseRequestOptions(options);
      const getOptions: CredentialRequestOptions = optionsObj.publicKey
        ? optionsObj
        : { publicKey: optionsObj as PublicKeyCredentialRequestOptions };
      const credential = (await navigator.credentials.get(getOptions)) as PublicKeyCredential | null;
      if (!credential) {
        toastPlainError("Sign-in was cancelled or failed");
        return;
      }
      const result = await authApi.passkeyAuthenticateVerify(credentialToJSON(credential));
      login(result.user);
      router.push(nextPath);
    } catch (err: unknown) {
      toastApiError("Passkey sign-in failed", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Wallet className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Snack&apos;s Budget</CardTitle>
          <CardDescription>
            {isRegister ? "Create your account" : "Sign in to your household budget"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Demo — first class */}
          {isDemo && (
            <>
              <Button
                type="button"
                className="w-full"
                size="lg"
                disabled={demoLoading}
                onClick={handleDemoLogin}
              >
                {demoLoading ? "Loading demo…" : <><Play className="mr-2 h-4 w-4" />Try the Demo</>}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Explore with sample data — no account needed
              </p>
              <Divider label="or sign in" />
            </>
          )}

          {/* Register */}
          {isRegister ? (
            <form className="space-y-3" onSubmit={(e) => e.preventDefault()} autoComplete="off">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              {canUsePasskey ? (
                <>
                  <Button type="button" className="w-full" disabled={loading} onClick={handleCreateWithPasskey}>
                    {loading ? "Creating…" : <><KeyRound className="mr-2 h-4 w-4" />Create account with passkey</>}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Uses your device&apos;s fingerprint, Face ID, or security key — no password needed.
                  </p>
                </>
              ) : (
                <p className="text-center text-sm text-muted-foreground">
                  Passkeys are not supported in this browser. Try Chrome, Safari, or Edge.
                </p>
              )}
            </form>
          ) : (
            /* Sign in */
            <div className="space-y-3">
              {/* Hero: passkey */}
              {canUsePasskey && (
                <Button
                  type="button"
                  className="w-full"
                  size="lg"
                  disabled={loading}
                  onClick={handleSignInWithPasskey}
                >
                  {loading ? "Signing in…" : <><KeyRound className="mr-2 h-4 w-4" />Sign in with passkey</>}
                </Button>
              )}

              {/* More options toggle */}
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setMoreOptionsToggled((o) => !o)}
                aria-expanded={moreOptionsOpen}
              >
                {moreOptionsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {canUsePasskey ? "More sign-in options" : "Sign in with email"}
              </button>

              {moreOptionsOpen && (
                <form onSubmit={handlePasswordSubmit} className="space-y-3" autoComplete="on" aria-label="Sign in">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                  </div>

                  {magicLinkSent ? (
                    <div className="flex items-start gap-3 rounded-md border border-green-600/30 bg-green-50/30 dark:bg-green-950/20 p-3 text-sm">
                      <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-green-600" />
                      <div>
                        <div className="font-medium">Check your email</div>
                        <p className="text-muted-foreground text-xs mt-1">
                          If <span className="font-medium text-foreground">{email}</span> is registered, a sign-in link is on its way. Expires in 15 minutes.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      className="w-full"
                      disabled={!email || magicLinkSending}
                      onClick={handleMagicLinkRequest}
                    >
                      {magicLinkSending ? "Sending…" : <><Mail className="mr-2 h-4 w-4" />Email me a sign-in link</>}
                    </Button>
                  )}

                  {!isDemo && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => { window.location.href = "/api/auth/google"; }}
                    >
                      <GoogleIcon />
                      Sign in with Google
                    </Button>
                  )}

                  <Divider label="or use password" />

                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                  <Button type="submit" variant="outline" className="w-full" disabled={loading || !password}>
                    {loading ? "Signing in…" : "Sign in with password"}
                  </Button>
                </form>
              )}
            </div>
          )}

          {/* Footer */}
          {isDemo ? (
            <p className="text-center text-xs text-muted-foreground pt-1">
              Account creation is disabled in the demo.
            </p>
          ) : (
            <p className="text-center text-sm text-muted-foreground pt-1">
              {isRegister ? "Already have an account?" : "Don’t have an account?"}{" "}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setIsRegister(!isRegister)}
              >
                {isRegister ? "Sign in" : "Create one"}
              </button>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
