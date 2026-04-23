"use client";

/**
 * EmptyState · Brand Blue Dual Theme V2 (ADR 0016 · proposals/v2 §3.14)
 *
 * Mesh-hero backdrop (soft primary + accent radial glows) over a dotgrid,
 * a floating gradient primary icon tile, h3 + description, optional action.
 *
 * Preserves public API: { title, description?, action?, children? }.
 */

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

export type StateAction = {
  label: string;
  onClick: () => void;
  /** Optional lucide icon for the primary action. */
  icon?: IconName;
};

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  icon = "sparkles",
  children,
}: {
  title: string;
  description?: string;
  action?: StateAction;
  secondaryAction?: StateAction;
  icon?: IconName;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      data-state="empty"
      className="relative overflow-hidden rounded-xl border border-border bg-surface px-6 py-10 text-center shadow-soft-sm"
    >
      {/* mesh hero — soft radial glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(420px 240px at 20% 15%, var(--color-primary-muted), transparent 65%)," +
            "radial-gradient(360px 220px at 80% 70%, color-mix(in srgb, var(--color-accent) 22%, transparent), transparent 65%)",
        }}
      />
      {/* dotgrid backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-border) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          maskImage:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.55), transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.55), transparent 75%)",
        }}
      />
      <div className="relative flex flex-col items-center">
        <div
          aria-hidden="true"
          className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-fg shadow-soft-lg animate-float"
        >
          <Icon name={icon} size={26} strokeWidth={1.75} />
        </div>
        <h3 className="mt-5 text-lg font-semibold tracking-tight text-text">
          {title}
        </h3>
        {description && (
          <p className="mt-2 max-w-md text-sm text-text-muted">{description}</p>
        )}
        {children && (
          <div className="mt-3 text-caption text-text-muted">{children}</div>
        )}
        {(action || secondaryAction) && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {action && (
              <button
                type="button"
                onClick={action.onClick}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-soft-sm transition-colors duration-base hover:bg-primary-hover hover:-translate-y-px"
              >
                {action.icon && <Icon name={action.icon} size={14} />}
                {action.label}
              </button>
            )}
            {secondaryAction && (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-muted transition-colors duration-base hover:border-border-strong hover:text-text hover:bg-surface-2"
              >
                {secondaryAction.icon && (
                  <Icon name={secondaryAction.icon} size={14} />
                )}
                {secondaryAction.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
