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

import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";

export function LoadingState({
  title,
  description,
  variant = "dots",
  lines,
}: {
  title?: string;
  description?: string;
  variant?: "dots" | "skeleton";
  /** When variant="skeleton", number of shimmer rows. Default 3. Ignored for "dots". */
  lines?: number;
}) {
  const t = useTranslations("state.loading");
  const resolvedTitle = title ?? t("defaultTitle");
  if (variant === "skeleton") {
    // Pseudo-randomised but deterministic widths so consecutive renders
    // (e.g. SSR vs hydration) match. Cycles through 60/40/75/55/68/45.
    const widths = ["60%", "40%", "75%", "55%", "68%", "45%"];
    const rows = Math.max(1, Math.min(8, lines ?? 3));
    return (
      <div
        role="status"
        aria-live="polite"
        data-state="loading"
        data-variant="skeleton"
        className="rounded-xl border border-border bg-surface px-4 py-4 space-y-2.5 shadow-soft-sm"
      >
        <span className="sr-only">{resolvedTitle}</span>
        {Array.from({ length: rows }, (_, i) => (
          <ShimmerBar key={i} width={widths[i % widths.length] ?? "60%"} />
        ))}
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
        <p className="text-sm font-medium text-text">{resolvedTitle}</p>
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
