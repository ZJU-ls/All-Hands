"use client";

/**
 * LoadingState · Brand Blue Dual Theme V2 (ADR 0016)
 *
 * Variants:
 * - "dots" (default) — a `loader` lucide icon (spin-slow) inside a tile +
 *   title + description, presented as a centered tile card.
 * - "skeleton" — row-stack of shimmer bars using the brand gradient.
 *
 * Preserves public API: { title?, description?, variant?: "dots" | "skeleton" }.
 */

import { Icon } from "@/components/ui/icon";

export function LoadingState({
  title = "加载中",
  description,
  variant = "dots",
}: {
  title?: string;
  description?: string;
  variant?: "dots" | "skeleton";
}) {
  if (variant === "skeleton") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-state="loading"
        data-variant="skeleton"
        className="rounded-xl border border-border bg-surface px-4 py-4 space-y-2.5 shadow-soft-sm"
      >
        <span className="sr-only">{title}</span>
        <ShimmerBar width="60%" />
        <ShimmerBar width="40%" />
        <ShimmerBar width="75%" />
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-state="loading"
      data-variant="dots"
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface px-6 py-8 text-center shadow-soft-sm"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-muted text-primary"
      >
        <Icon name="loader" size={20} className="animate-spin-slow" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{title}</p>
        {description && (
          <p className="mt-1 text-caption text-text-muted">{description}</p>
        )}
      </div>
    </div>
  );
}

function ShimmerBar({ width }: { width: string | number }) {
  return (
    <div
      className="h-2.5 rounded-full bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%] animate-shimmer"
      style={{ width: typeof width === "number" ? `${width}px` : width }}
    />
  );
}
