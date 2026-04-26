"use client";

/**
 * Skeleton · low-level shimmer block · use for "we know the shape, content
 * lands in <500ms" loading states. For longer waits (>1s) prefer the
 * progress-bearing `LoadingState` so users know it's not stuck.
 *
 * Reference inspiration: shadcn/ui Skeleton · Linear post-load shimmer.
 *
 * Token-only colors per ADR 0016 §3.8 — `bg-surface-2` ground, animation
 * uses `animate-pulse` from Tailwind core (no JS).
 */

import { cn } from "@/lib/cn";

export function Skeleton({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-md bg-surface-2",
        className,
      )}
      {...rest}
    />
  );
}
