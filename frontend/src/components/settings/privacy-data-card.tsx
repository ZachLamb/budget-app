"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Download, ShieldAlert, Trash2, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  meApi,
  DELETE_CONFIRMATION_PHRASE,
  type ExportDownload,
} from "@/lib/api/me";
import { useAuth } from "@/lib/providers";
import { toastApiError } from "@/lib/toast-error";
import { appToast } from "@/lib/app-toast";

/** Programmatic browser download of an in-memory blob. */
function triggerDownload({ blob, filename }: ExportDownload): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Some browsers require the anchor to be in the DOM before click.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on next tick so the click has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function PrivacyDataCard() {
  const router = useRouter();
  const { logout } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");

  const exportMutation = useMutation({
    mutationFn: () => meApi.exportData(),
    onSuccess: (download) => {
      triggerDownload(download);
      appToast.success("Export downloaded");
    },
    onError: (e) => toastApiError("Failed to export data", e),
  });

  const deleteMutation = useMutation({
    mutationFn: () => meApi.deleteAccount(),
    onSuccess: () => {
      // Tear down client-side auth before navigating so AuthGuard can't
      // briefly render the protected page during the redirect.
      logout();
      setConfirmOpen(false);
      setConfirmInput("");
      appToast.success("Account deleted.");
      router.push("/login");
    },
    onError: (e) => {
      // Don't log the user out — they're still authenticated and might
      // want to retry or read the error.
      toastApiError("Failed to delete account", e);
    },
  });

  const phraseMatches = confirmInput === DELETE_CONFIRMATION_PHRASE;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            Privacy &amp; data
          </CardTitle>
          <CardDescription>
            Download a copy of everything we have for your account, or permanently delete
            your account and all associated data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-medium">Export my data</p>
            <p className="text-xs text-muted-foreground">
              Includes accounts, transactions, budgets, goals, and settings as a JSON file.
              Limited to 5 exports per day.
            </p>
            <Button
              type="button"
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
            >
              {exportMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Preparing export…
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" aria-hidden />
                  Export my data
                </>
              )}
            </Button>
          </div>

          <div className="space-y-2 border-t pt-6">
            <p className="text-sm font-medium">Delete my account</p>
            <p className="text-xs text-muted-foreground">
              Permanently removes your account, all transactions, and your household. This
              cannot be undone — export your data first if you want a copy.
            </p>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmInput("");
                setConfirmOpen(true);
              }}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden />
              Delete my account
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (deleteMutation.isPending) return;
          setConfirmOpen(o);
          if (!o) setConfirmInput("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" aria-hidden />
              Delete your account?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes your account, every transaction, your budgets and
              goals, and your household. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-confirm-input">
              Type{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                {DELETE_CONFIRMATION_PHRASE}
              </code>{" "}
              to confirm
            </Label>
            <Input
              id="delete-confirm-input"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              disabled={deleteMutation.isPending}
              placeholder={DELETE_CONFIRMATION_PHRASE}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
                setConfirmInput("");
              }}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={!phraseMatches || deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Deleting…
                </>
              ) : (
                "Delete my account"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
