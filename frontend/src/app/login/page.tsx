"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/providers";
import { authApi, credentialToJSON } from "@/lib/api/auth";
import { parseCreationOptions, parseRequestOptions, supportsPasskey } from "@/lib/webauthn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, KeyRound, Play } from "lucide-react";
import { toastApiError, toastPlainError } from "@/lib/toast-error";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Google sign-in was cancelled or denied.",
  missing_params: "Missing response from Google. Please try again.",
  invalid_state: "Invalid state. Please try again.",
  token_failed: "Could not sign in with Google. Please try again.",
  userinfo_failed: "Could not load your Google profile. Please try again.",
  invalid_profile: "Google did not provide required profile information.",
  server_error:
    "Something went wrong on the server. If you just added Google sign-in, run the database migration (see backend/migrations/001_google_oauth.sql) and restart.",
  demo_oauth_disabled:
    'Google sign-in is turned off for the demo. Use "Try the Demo" or email sign-in.',
  demo_oauth_signup_disabled:
    'New Google accounts cannot be created in the demo. Use "Try the Demo" or an account that already exists on this server.',
};

function LoginPageContent() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [canUsePasskey, setCanUsePasskey] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    setCanUsePasskey(supportsPasskey());
  }, []);

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
      login(result.access_token, result.user);
      router.push("/");
    } catch (e) {
      toastApiError("Demo login failed. Is the backend running in demo mode?", e);
    } finally {
      setDemoLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegister) return; // Register is passkey-only
    setLoading(true);
    try {
      const result = await authApi.login({ email, password });
      login(result.access_token, result.user);
      router.push("/");
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
      const result = await authApi.passkeyRegisterVerify(credentialToJSON(credential));
      login(result.access_token, result.user);
      router.push("/onboarding");
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
      login(result.access_token, result.user);
      router.push("/");
    } catch (err: unknown) {
      toastApiError("Passkey sign-in failed", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Wallet className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Clarity</CardTitle>
          <CardDescription>
            {isRegister
              ? "Private budgeting and goals — AI stays off until you enable it."
              : "Sign in to your household budget"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isDemo && (
            <div className="mb-4 space-y-3">
              <Button
                type="button"
                className="w-full"
                size="lg"
                disabled={demoLoading}
                onClick={handleDemoLogin}
              >
                {demoLoading ? "Loading demo…" : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Try the Demo
                  </>
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Explore with sample data — no account needed
              </p>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or sign in</span>
                </div>
              </div>
            </div>
          )}
          <form
            onSubmit={handlePasswordSubmit}
            className="space-y-4"
            autoComplete={isRegister ? "off" : "on"}
            aria-label={isRegister ? "Create account with passkey" : "Sign in"}
          >
            {isRegister && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            {!isRegister && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              </div>
            )}
            {isRegister ? (
              canUsePasskey ? (
                <>
                  <Button
                    type="button"
                    className="w-full"
                    disabled={loading}
                    onClick={handleCreateWithPasskey}
                  >
                    {loading ? "Creating…" : (
                      <>
                        <KeyRound className="mr-2 h-4 w-4" />
                        Create account with passkey
                      </>
                    )}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Uses your device&apos;s fingerprint, Face ID, or security key — no password.
                  </p>
                </>
              ) : (
                <p className="text-center text-sm text-muted-foreground">
                  Passkeys are not supported in this browser. Try Chrome, Safari, or Edge.
                </p>
              )
            ) : (
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Loading..." : "Sign In"}
              </Button>
            )}
            {!isRegister && canUsePasskey && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or</span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={loading}
                  onClick={handleSignInWithPasskey}
                >
                  <KeyRound className="mr-2 h-4 w-4" />
                  Sign in with passkey
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    window.location.href = "/api/auth/google";
                  }}
                >
                  <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden>
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Sign in with Google
                </Button>
              </>
            )}
            <p className="text-center text-sm text-muted-foreground">
              {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
              <button type="button" className="text-primary hover:underline" onClick={() => setIsRegister(!isRegister)}>
                {isRegister ? "Sign in" : "Create one"}
              </button>
            </p>
          </form>
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
