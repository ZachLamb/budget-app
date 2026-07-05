import type { ToasterProps } from "sonner";

/** Stable id so duplicate errors replace instead of stacking. */
export function toastDedupeId(kind: string, title: string): string {
  return `${kind}:${title}`.slice(0, 120);
}

/** Shared Sonner defaults — top-right, capped stack, clear spacing from chrome. */
export const TOASTER_PROPS: ToasterProps = {
  position: "top-right",
  expand: false,
  visibleToasts: 3,
  closeButton: true,
  gap: 10,
  /** Below mobile header / safe area; clear of sidebar on desktop. */
  offset: {
    top: "max(1rem, env(safe-area-inset-top, 0px))",
    right: "max(1rem, env(safe-area-inset-right, 0px))",
  },
  mobileOffset: {
    top: "max(4.25rem, calc(env(safe-area-inset-top, 0px) + 3.25rem))",
    right: "max(0.75rem, env(safe-area-inset-right, 0px))",
  },
  toastOptions: {
    classNames: {
      toast:
        "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
      description: "group-[.toast]:text-muted-foreground",
      actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
      cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
    },
  },
};

export const TOAST_DURATION = {
  success: 3500,
  info: 4500,
  warning: 7000,
  error: 8000,
  copy: 2000,
} as const;
