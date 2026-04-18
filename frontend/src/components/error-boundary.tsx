"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /**
   * Number of times "Try again" has been clicked for the current mount.
   * After the threshold we hide the retry button and push the user toward
   * a full reload — retrying the same subtree against a stable failure
   * cause (bad localStorage value, missing env, etc.) only flashes the
   * same error repeatedly.
   */
  retries: number;
}

const MAX_RETRIES = 2;

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retries: 0 };
  }

  static getDerivedStateFromError(error: Error): Pick<State, "hasError" | "error"> {
    return { hasError: true, error };
  }

  private handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      retries: prev.retries + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const retryExhausted = this.state.retries >= MAX_RETRIES;

      return (
        <div className="flex items-center justify-center p-8">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6 text-center space-y-4">
              <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
              <h2 className="text-lg font-semibold">Something went wrong</h2>
              <p className="text-sm text-muted-foreground">
                {retryExhausted
                  ? "This keeps failing. A full reload may clear it — if it persists, please report it."
                  : "Something broke while rendering this screen. You can try again or reload the page."}
              </p>
              {process.env.NODE_ENV === "development" && this.state.error?.message ? (
                <p className="text-xs font-mono text-muted-foreground break-all">
                  {this.state.error.message}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-center gap-2">
                {!retryExhausted && (
                  <Button onClick={this.handleRetry}>Try again</Button>
                )}
                <Button
                  variant={retryExhausted ? "default" : "outline"}
                  onClick={() => typeof window !== "undefined" && window.location.reload()}
                >
                  Reload page
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
