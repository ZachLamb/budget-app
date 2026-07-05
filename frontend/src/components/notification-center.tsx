"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BellOff,
  CheckCircle2,
  CircleAlert,
  Info,
  TriangleAlert,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  useNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  clearAllNotifications,
  type AppNotification,
  type NotificationKind,
} from "@/lib/notification-store";
import { cn } from "@/lib/utils";
import { appToast } from "@/lib/app-toast";

function relativeTime(ts: number, nowMs: number): string {
  const s = Math.floor((nowMs - ts) / 1000);
  if (s < 10) return "Just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function KindIcon({ kind }: { kind: NotificationKind }) {
  const common = "h-4 w-4 shrink-0";
  switch (kind) {
    case "success":
      return <CheckCircle2 className={cn(common, "text-green-600 dark:text-green-500")} aria-hidden />;
    case "info":
      return <Info className={cn(common, "text-blue-600 dark:text-blue-400")} aria-hidden />;
    case "warning":
      return <TriangleAlert className={cn(common, "text-amber-600 dark:text-amber-500")} aria-hidden />;
    default:
      return <CircleAlert className={cn(common, "text-destructive")} aria-hidden />;
  }
}

function kindStripeClass(kind: NotificationKind): string {
  switch (kind) {
    case "success":
      return "border-l-green-500";
    case "info":
      return "border-l-blue-500";
    case "warning":
      return "border-l-amber-500";
    default:
      return "border-l-destructive";
  }
}

function NotificationRow({ n, nowMs }: { n: AppNotification; nowMs: number }) {
  const unread = !n.read;

  const handleDismiss = () => {
    if (unread) markNotificationRead(n.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!unread) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleDismiss();
    }
  };

  return (
    <div
      className={cn(
        "group relative rounded-lg border border-border/80 bg-card/80 text-left shadow-sm transition-colors",
        "border-l-4 pl-2.5 pr-2 py-2.5",
        kindStripeClass(n.kind),
        unread && "bg-muted/50 ring-1 ring-primary/10 dark:ring-primary/20",
        unread && "cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        !unread && "opacity-90",
      )}
      role={unread ? "button" : undefined}
      tabIndex={unread ? 0 : undefined}
      onClick={unread ? handleDismiss : undefined}
      onKeyDown={unread ? handleKeyDown : undefined}
      aria-label={
        unread
          ? `${n.title}. ${n.description ?? ""}. Press Enter or click to mark as read.`
          : undefined
      }
    >
      <div className="flex gap-2.5">
        <div className="pt-0.5">
          <KindIcon kind={n.kind} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium leading-snug text-foreground">{n.title}</p>
            {unread ? (
              <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                New
              </span>
            ) : (
              <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45" aria-hidden />
            )}
          </div>
          {n.description ? (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{n.description}</p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <time
              className="text-[10px] tabular-nums text-muted-foreground"
              dateTime={new Date(n.createdAt).toISOString()}
            >
              {relativeTime(n.createdAt, nowMs)}
            </time>
            {n.detailClipboard ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  void navigator.clipboard.writeText(n.detailClipboard!).then(
                    () => appToast.success("Copied details"),
                    () => appToast.warning("Could not copy"),
                  );
                }}
              >
                Copy details
              </Button>
            ) : null}
          </div>
          {unread ? (
            <p className="text-[10px] text-muted-foreground/80">Click or press Enter to dismiss</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 first:pt-0">
      {children}
    </p>
  );
}

/** Bell + dropdown listing in-app notifications (errors, successes, info). */
export function NotificationBell({ className }: { className?: string }) {
  const notifications = useNotifications();
  const unread = notifications.filter((n) => !n.read).length;
  const [open, setOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Defer the "fresh nowMs on open" update to a task so it's not a
    // synchronous setState in the effect body — the cascading-render
    // pattern the hooks plugin warns about. setInterval handles the
    // every-30s refresh afterward.
    const id0 = window.setTimeout(() => setNowMs(Date.now()), 0);
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => {
      window.clearTimeout(id0);
      window.clearInterval(id);
    };
  }, [open]);

  const { unreadItems, readItems } = useMemo(() => {
    const u: AppNotification[] = [];
    const r: AppNotification[] = [];
    for (const n of notifications) {
      if (n.read) r.push(n);
      else u.push(n);
    }
    return { unreadItems: u, readItems: r };
  }, [notifications]);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("relative shrink-0", className)}
            aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
            aria-expanded={open}
            aria-haspopup="menu"
          >
            <Bell className="h-5 w-5" />
            {unread > 0 ? (
              <Badge
                variant="destructive"
                className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 py-0 text-[10px] leading-none shadow-sm"
              >
                {unread > 9 ? "9+" : unread}
              </Badge>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[min(calc(100vw-1.5rem),24rem)] overflow-hidden rounded-xl border-border/60 p-0 shadow-lg"
          sideOffset={8}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="border-b border-border/60 bg-muted/30 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold leading-tight">Notifications</h2>
                <p className="text-xs text-muted-foreground">
                  {notifications.length === 0
                    ? "You’re all caught up"
                    : unread > 0
                      ? `${unread} unread${notifications.length > unread ? ` · ${notifications.length} total` : ""}`
                      : `${notifications.length} saved`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={unread === 0}
                  onClick={() => markAllNotificationsRead()}
                >
                  Read all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                  disabled={notifications.length === 0}
                  onClick={() => {
                    setOpen(false);
                    window.setTimeout(() => setConfirmClearOpen(true), 0);
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>

          <ScrollArea className="max-h-[min(380px,55vh)]">
            <div
              className="space-y-1.5 p-2"
              role="region"
              aria-label="Notification list"
              aria-live="polite"
            >
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <BellOff className="h-6 w-6 text-muted-foreground" aria-hidden />
                  </div>
                  <p className="text-sm font-medium text-foreground">No notifications</p>
                  <p className="max-w-[16rem] text-xs leading-relaxed text-muted-foreground">
                    Alerts from the app and error details from failed requests will appear here. You can copy diagnostics when something goes wrong.
                  </p>
                </div>
              ) : (
                <>
                  {unreadItems.length > 0 ? (
                    <>
                      <SectionLabel>Unread</SectionLabel>
                      <div className="space-y-2">
                        {unreadItems.map((n) => (
                          <NotificationRow key={n.id} n={n} nowMs={nowMs} />
                        ))}
                      </div>
                    </>
                  ) : null}
                  {readItems.length > 0 ? (
                    <>
                      <SectionLabel>{unreadItems.length > 0 ? "Earlier" : "Recent"}</SectionLabel>
                      <div className="space-y-2">
                        {readItems.map((n) => (
                          <NotificationRow key={n.id} n={n} nowMs={nowMs} />
                        ))}
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear all notifications?"
        description="This removes every item from your notification list. It won’t undo any actions in your budget."
        confirmLabel="Clear all"
        variant="destructive"
        onConfirm={() => {
          clearAllNotifications();
          appToast.success("Notifications cleared");
        }}
      />
    </>
  );
}
