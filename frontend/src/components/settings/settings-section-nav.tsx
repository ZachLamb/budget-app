"use client";

import { cn } from "@/lib/utils";

export type SettingsSectionId =
  | "setup"
  | "account"
  | "security"
  | "bank"
  | "pay"
  | "ai"
  | "privacy"
  | "hosting"
  | "admin";

const BASE_SECTIONS: { id: SettingsSectionId; label: string }[] = [
  { id: "setup", label: "Getting started" },
  { id: "account", label: "Account" },
  { id: "security", label: "Sign-in" },
  { id: "bank", label: "Bank & sync" },
  { id: "pay", label: "Pay schedule" },
  { id: "ai", label: "AI" },
  { id: "privacy", label: "Privacy" },
];

export function SettingsSectionNav({
  showAdmin,
  className,
}: {
  showAdmin?: boolean;
  className?: string;
}) {
  // Hosting + Admin sections render for admins only (backend enforces too).
  const sections = showAdmin
    ? [
        ...BASE_SECTIONS,
        { id: "hosting" as const, label: "Hosting" },
        { id: "admin" as const, label: "Admin" },
      ]
    : BASE_SECTIONS;

  return (
    <nav
      aria-label="Settings sections"
      className={cn(
        "sticky top-4 z-10 -mx-1 flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0",
        className,
      )}
    >
      {sections.map(({ id, label }) => (
        <a
          key={id}
          href={`#${id}`}
          className={cn(
            "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground",
            "transition-colors hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
