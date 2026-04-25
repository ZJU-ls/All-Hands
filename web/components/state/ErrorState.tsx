"use client";

/**
 * ErrorState · Brand Blue Dual Theme V2 (ADR 0016)
 *
 * Layout: rounded-xl danger-soft card with an alert-circle icon tile,
 * title + description + optional detail <pre> + optional retry button
 * styled as a danger-outlined button.
 *
 * Preserves public API: { title, description?, action?, detail?, children? }.
 */

import type { ReactNode } from "react";
import type { StateAction } from "./EmptyState";
import { Icon } from "@/components/ui/icon";

export function ErrorState({
  title,
  description,
  action,
  detail,
  children,
}: {
  title: string;
  description?: string;
  action?: StateAction;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="alert"
      data-state="error"
      className="rounded-xl border border-danger/45 bg-danger-soft p-5 shadow-soft-sm ring-1 ring-danger/10"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger"
        >
          <Icon name="alert-circle" size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-danger">{title}</p>
          {description && (
            <p className="mt-1 text-caption text-text-muted">{description}</p>
          )}
          {detail && (
            <pre className="mt-2.5 max-h-40 overflow-auto rounded-md border border-danger/20 bg-surface/60 p-2 font-mono text-caption text-text-muted whitespace-pre-wrap break-words">
              {detail}
            </pre>
          )}
          {children && (
            <div className="mt-2.5 text-sm text-text-muted">{children}</div>
          )}
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-3 py-1.5 text-caption font-medium text-danger transition-colors duration-base hover:bg-danger/10 hover:border-danger/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-danger/30"
            >
              <Icon name="refresh" size={12} />
              {action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
