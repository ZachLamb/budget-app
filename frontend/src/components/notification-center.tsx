"use client";

import { Bell, CheckCircle2, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  clearAllNotifications,
  type AppNotification,
  type NotificationKind,
} from "@/lib/notification-store";
import { cn } from "@/lib/utils";
import { toast as sonnerToast } from "sonner";

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
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
      return <CheckCircle2 className={cn(common, "text-green-600")} aria-hidden />;
    case "info":
      return <Info className={cn(common, "text-blue-600")} aria-hidden />;
    case "warning":
      return <TriangleAlert className={cn(common, "text-amber-600")} aria-hidden />;
    default:
      return <CircleAlert className={cn(common, "text-destructive")} aria-hidden />;
  }
}

function NotificationRow({ n }: { n: AppNotification }) {
  return (
    <div
      className={cn(
        "flex gap-2 border-b px-3 py-2.5 text-left last:border-b-0",
        !n.read && "bg-muted/40",
      )}
    >
      <KindIcon kind={n.kind} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium leading-tight text-foreground">{n.title}</p>
        {n.description ? (
          <p className="text-xs text-muted-foreground leading-snug line-clamp-3">{n.description}</p>
        ) : null}
        <p className="text-[10px] text-muted-foreground">{relativeTime(n.createdAt)}</p>
        <div className="flex flex-wrap gap-1 pt-0.5">
          {!n.read && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markNotificationRead(n.id)}
            >
              Mark read
            </Button>
          )}
          {n.detailClipboard ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                void navigator.clipboard.writeText(n.detailClipboard!).then(
                  () => sonnerToast.success("Copied", { duration: 1500 }),
                  () => sonnerToast.error("Copy failed", { duration: 2000 }),
                );
              }}
            >
              Copy
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Bell + dropdown listing in-app notifications (errors, successes, info). */
export function NotificationBell({ className }: { className?: string }) {
  const notifications = useNotifications();
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("relative shrink-0", className)}
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        >
          <Bell className="h-5 w-5" />
          {unread > 0 ? (
            <Badge
              variant="destructive"
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 py-0 text-[10px] leading-none"
            >
              {unread > 9 ? "9+" : unread}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(calc(100vw-2rem),22rem)] p-0" sideOffset={8}>
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={notifications.length === 0}
              onClick={() => markAllNotificationsRead()}
            >
              Mark all read
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={notifications.length === 0}
              onClick={() => clearAllNotifications()}
            >
              Clear
            </Button>
          </div>
        </div>
        <ScrollArea className="max-h-[min(320px,50vh)]">
          {notifications.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No notifications yet. Toasts and alerts will show up here.
            </p>
          ) : (
            notifications.map((n) => <NotificationRow key={n.id} n={n} />)
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
