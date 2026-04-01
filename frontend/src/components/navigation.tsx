"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth, useTheme } from "@/lib/providers";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Tags,
  Settings,
  LogOut,
  RefreshCw,
  PiggyBank,
  Repeat,
  Wand2,
  Users,
  BarChart3,
  Menu,
  Moon,
  Sun,
  Map,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { syncApi } from "@/lib/api/sync";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useIsClient, getApiErrorMessage } from "@/lib/hooks";
import { shouldShowMobileSyncBanner } from "@/lib/ux-plan-logic";
import { toast } from "sonner";

const primaryNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/budget", label: "Budget", icon: PiggyBank },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/plan", label: "Plan", icon: Map },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

const manageNavItems = [
  { href: "/recurring", label: "Recurring", icon: Repeat },
  { href: "/categories", label: "Categories", icon: Tags },
  { href: "/payees", label: "Payees", icon: Users },
  { href: "/rules", label: "Rules", icon: Wand2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLink({ href, label, icon: Icon, onNavigate }: { href: string; label: string; icon: React.ElementType; onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 px-3 py-4 overflow-auto">
      {/* Primary — daily use */}
      <div className="space-y-1">
        {primaryNavItems.map((item) => (
          <NavLink key={item.href} {...item} onNavigate={onNavigate} />
        ))}
      </div>

      {/* Manage — config / power-user */}
      <div className="mt-6">
        <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
          Manage
        </p>
        <div className="space-y-1">
          {manageNavItems.map((item) => (
            <NavLink key={item.href} {...item} onNavigate={onNavigate} />
          ))}
        </div>
      </div>
    </nav>
  );
}

function SidebarFooter() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();
  const isClient = useIsClient();

  const { data: syncStatus } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: syncApi.status,
    refetchInterval: (query) => (query.state.data?.syncing ? 3000 : 10000),
    enabled: isClient,
  });

  const prevSyncing = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (prevSyncing.current === true && syncStatus?.syncing === false) {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["debtAccounts"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["payees"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["syncHistory"] });
      queryClient.invalidateQueries({ queryKey: ["syncStatus"] });
    }
    prevSyncing.current = syncStatus?.syncing;
  }, [syncStatus?.syncing, queryClient]);

  const syncMutation = useMutation({
    mutationFn: syncApi.trigger,
    onSuccess: () => {
      toast.success("Sync started");
      queryClient.invalidateQueries({ queryKey: ["syncStatus"] });
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "Failed to start sync")),
  });

  return (
    <div className="border-t px-3 py-4 space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2"
        onClick={() => syncMutation.mutate()}
        disabled={syncMutation.isPending || syncStatus?.syncing}
      >
        <RefreshCw
          className={cn(
            "h-4 w-4",
            (syncMutation.isPending || syncStatus?.syncing) && "animate-spin"
          )}
        />
        {syncStatus?.syncing ? "Syncing..." : "Sync Now"}
      </Button>
      {syncStatus?.last_sync?.completed_at && (
        <p className="px-1 text-xs text-muted-foreground">
          Last synced:{" "}
          {new Date(syncStatus.last_sync.completed_at).toLocaleString()}
        </p>
      )}
      {syncStatus?.last_sync &&
        shouldShowMobileSyncBanner(syncStatus.last_sync) && (
          <p className="px-1 text-xs text-destructive leading-snug" role="status">
            {syncStatus.last_sync.status === "partial" ? "Sync partially completed. " : "Sync issue. "}
            {syncStatus.last_sync.error_message ?? "Open Settings to check your bank connection."}
          </p>
        )}
      <div className="flex items-center justify-between px-1">
        <span className="text-sm text-muted-foreground truncate">
          {user?.email}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-8 w-8"
            aria-label="Toggle dark mode"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            className="h-8 w-8"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MobileHeader() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden sticky top-0 z-40 flex items-center gap-2 border-b bg-card px-4 py-3">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-primary" />
        <span className="font-semibold">Clarity</span>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex items-center gap-2 border-b px-6 py-4">
            <Wallet className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold">Clarity</span>
          </div>
          <div className="flex flex-col h-[calc(100%-57px)]">
            <NavContent onNavigate={() => setOpen(false)} />
            <SidebarFooter />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function Navigation() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <aside className="hidden md:flex h-screen w-64 flex-col border-r bg-card" aria-label="Primary navigation">
      <div className="flex items-center gap-2 border-b px-6 py-4">
        <Wallet className="h-6 w-6 text-primary" />
        <span className="text-lg font-semibold">Clarity</span>
      </div>
      <NavContent />
      <SidebarFooter />
    </aside>
  );
}
