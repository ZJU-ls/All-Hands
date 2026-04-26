"use client";

/**
 * StatusPill · single, themeable status tag used across runs / traces /
 * artifacts / employees. Centralises the (kind → tone, icon) mapping so
 * we stop drifting between border-success/30, text-success-soft, etc.
 *
 * Reference: GitHub PR labels (subtle border + soft fill), Linear status
 * chips. Token-only colors per ADR 0016 §3.8 — no Tailwind raw colors.
 *
 * Usage:
 *   <StatusPill kind="success">running</StatusPill>
 *   <StatusPill kind="failed" icon="x" />
 *   <StatusPill kind="muted" dot>queued</StatusPill>
 */

import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

export type StatusKind =
  | "success"
  | "failed"
  | "warning"
  | "info"
  | "running"
  | "muted";

const TONE: Record<StatusKind, string> = {
  success: "border-success/30 bg-success-soft text-success",
  failed: "border-danger/30 bg-danger-soft text-danger",
  warning: "border-warning/30 bg-warning-soft text-warning",
  info: "border-primary/30 bg-primary-muted text-primary",
  running: "border-primary/30 bg-primary-muted text-primary",
  muted: "border-border bg-surface-2 text-text-muted",
};

const DEFAULT_ICON: Record<StatusKind, IconName | null> = {
  success: "check-circle-2",
  failed: "alert-circle",
  warning: "alert-triangle",
  info: "info",
  running: null,
  muted: null,
};

export function StatusPill({
  kind,
  icon,
  dot,
  className,
  children,
  size = "sm",
}: {
  kind: StatusKind;
  /** Override the auto-picked icon. Pass `null` to suppress. */
  icon?: IconName | null;
  /** Render a 6px colored dot instead of an icon. Wins over `icon`. */
  dot?: boolean;
  className?: string;
  children?: React.ReactNode;
  size?: "xs" | "sm";
}) {
  const eff = icon === undefined ? DEFAULT_ICON[kind] : icon;
  const sizes =
    size === "xs"
      ? "h-5 px-1.5 text-[10px]"
      : "h-6 px-2 text-[11px]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        sizes,
        TONE[kind],
        className,
      )}
    >
      {dot ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      ) : eff ? (
        <Icon name={eff} size={size === "xs" ? 10 : 11} />
      ) : null}
      {children ? <span>{children}</span> : null}
    </span>
  );
}
