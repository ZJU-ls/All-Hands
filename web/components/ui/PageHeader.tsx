"use client";

/**
 * PageHeader · Unified page-title row · Linear Precise
 *
 * Replaces the ad-hoc "<h1>…</h1> + maybe a button" pattern scattered
 * across route pages. One header, one shape: title · count · subtitle ·
 * actions. Entrance uses ah-fade-up (§10.4).
 */

import type { ReactNode } from "react";

export function PageHeader({
  title,
  count,
  subtitle,
  meta,
  actions,
  className = "",
}: {
  title: string;
  /** Optional inline count e.g. "· 12". Displayed as mono dim text. */
  count?: number | string;
  /** Secondary line under the title. */
  subtitle?: ReactNode;
  /** Right-aligned chips (model / env / timestamp), mono + muted. */
  meta?: ReactNode;
  /** Right-side actions (buttons). */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`flex items-start justify-between gap-4 ${className}`}
      style={{ animation: "ah-fade-up 220ms var(--ease-out) both" }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-lg font-semibold tracking-tight text-text truncate">
            {title}
          </h1>
          {count !== undefined && count !== null && (
            <span className="font-mono text-[11px] text-text-subtle tabular-nums">
              · {count}
            </span>
          )}
          {meta && (
            <span className="font-mono text-[11px] text-text-subtle ml-auto">
              {meta}
            </span>
          )}
        </div>
        {subtitle && (
          <div className="mt-1 text-[12px] text-text-muted">{subtitle}</div>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </header>
  );
}
