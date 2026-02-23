"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/providers";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Tags,
  Settings,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncApi } from "@/lib/api/sync";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/categories", label: "Categories", icon: Tags },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Navigation() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();

  const { data: syncStatus } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: syncApi.status,
    refetchInterval: 10000,
  });

  const syncMutation = useMutation({
    mutationFn: syncApi.trigger,
    onSuccess: () => {
      toast.success("Sync started");
      queryClient.invalidateQueries({ queryKey: ["syncStatus"] });
    },
    onError: () => toast.error("Failed to start sync"),
  });

  if (!user) return null;

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-card">
      <div className="flex items-center gap-2 border-b px-6 py-4">
        <Wallet className="h-6 w-6 text-primary" />
        <span className="text-lg font-semibold">Budget</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t px-3 py-4 space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending || syncStatus?.syncing}
        >
          <RefreshCw className={cn("h-4 w-4", (syncMutation.isPending || syncStatus?.syncing) && "animate-spin")} />
          {syncStatus?.syncing ? "Syncing..." : "Sync Now"}
        </Button>
        {syncStatus?.last_sync?.completed_at && (
          <p className="px-1 text-xs text-muted-foreground">
            Last synced: {new Date(syncStatus.last_sync.completed_at).toLocaleString()}
          </p>
        )}
        <div className="flex items-center justify-between px-1">
          <span className="text-sm text-muted-foreground truncate">{user.email}</span>
          <Button variant="ghost" size="icon" onClick={logout} className="h-8 w-8">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
