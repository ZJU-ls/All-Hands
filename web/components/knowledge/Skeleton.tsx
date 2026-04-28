"use client";

/**
 * Tiny skeleton primitives for the KB pages. Replaces inconsistent
 * "loading…" text with a subtle pulse animation matching Linear / Notion.
 *
 * Two shapes:
 *   <SkeletonRow> · single horizontal bar (text line / chip placeholder)
 *   <SkeletonCard> · larger block for cards / KPI tiles
 *
 * Pulse uses Tailwind's animate-pulse + a soft surface-2 fill so the dark /
 * light themes both look right with no extra config.
 */

export function SkeletonRow({
  width = "100%",
  className = "",
}: {
  width?: string | number;
  className?: string;
}) {
  return (
    <div
      style={{ width: typeof width === "number" ? `${width}px` : width }}
      className={`h-3 animate-pulse rounded-md bg-surface-2 ${className}`}
    />
  );
}

export function SkeletonCard({
  className = "",
  height = 80,
}: {
  className?: string;
  height?: number;
}) {
  return (
    <div
      style={{ height: `${height}px` }}
      className={`animate-pulse rounded-xl border border-border bg-surface-2 ${className}`}
    />
  );
}

/** A doc-card-shaped placeholder — title + meta + 2-line preview. */
export function SkeletonDocCard() {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <SkeletonRow width="65%" className="h-4" />
        <SkeletonRow width={48} className="h-4" />
      </div>
      <div className="mt-3 flex gap-2">
        <SkeletonRow width={60} />
        <SkeletonRow width={50} />
        <SkeletonRow width={40} />
      </div>
      <div className="mt-3 space-y-1.5">
        <SkeletonRow width="100%" />
        <SkeletonRow width="80%" />
      </div>
    </div>
  );
}
