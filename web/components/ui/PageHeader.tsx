"use client";

/**
 * PageHeader · Unified page-title row · Brand Blue Dual Theme (ADR 0016)
 *
 * Replaces the ad-hoc "<h1>…</h1> + maybe a button" pattern scattered across
 * route pages. One header, one shape: title · count · subtitle · meta ·
 * actions. Entrance uses ah-fade-up (03-visual-design §1.10).
 *
 * Visual upgrade 2026-04-23: h1 bumped from 19px → 24px (text-xl) so page
 * titles feel like titles — the old sizing was indistinguishable from
 * inline card headers.
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
  /** Secondary line under the title. Free-form ReactNode. */
  subtitle?: ReactNode;
  /** Right-aligned meta chips (model / env / timestamp). Mono + muted. */
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
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h1 className="truncate text-xl font-semibold tracking-tight text-text">
            {title}
          </h1>
          {count !== undefined && count !== null && (
            <span className="font-mono text-caption tabular-nums text-text-subtle">
              · {count}
            </span>
          )}
          {meta && (
            <span className="ml-auto font-mono text-caption text-text-subtle">
              {meta}
            </span>
          )}
        </div>
        {subtitle && (
          <div className="mt-1.5 text-sm text-text-muted">{subtitle}</div>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
