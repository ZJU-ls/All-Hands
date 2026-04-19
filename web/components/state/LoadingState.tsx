"use client";

/**
 * LoadingState · 加载态 · Linear Precise
 *
 * Visual contract:
 * - 不用 spinner 图标库。按 design-system §2.13 + design-lab "三点省略" 做,
 *   一行 title + 三个 pulse dot(ah-dot keyframe · 已在 globals.css)。
 * - variant="skeleton" 时走 shimmer bar(ah-shimmer)· 无文字。
 * - 颜色全走 token(text-text-muted · bg-primary · surface-2/3)。
 */

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
        className="rounded-md border border-border bg-surface px-4 py-3 space-y-2"
      >
        <span className="sr-only">{title}</span>
        <ShimmerBar width={180} />
        <ShimmerBar width={120} />
        <ShimmerBar width={220} />
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-state="loading"
      data-variant="dots"
      className="rounded-md border border-border bg-surface px-4 py-3 flex items-center gap-3"
    >
      <span className="flex items-center gap-1" aria-hidden="true">
        <PulseDot delay={0} />
        <PulseDot delay={150} />
        <PulseDot delay={300} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-text">{title}</p>
        {description && (
          <p className="mt-0.5 text-[11px] text-text-muted">{description}</p>
        )}
      </div>
    </div>
  );
}

function PulseDot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block w-[6px] h-[6px] rounded-full bg-primary"
      style={{ animation: `ah-dot 1.2s ease-in-out ${delay}ms infinite` }}
    />
  );
}

function ShimmerBar({ width }: { width: number }) {
  return (
    <div
      className="rounded-full h-2 bg-surface-2"
      style={{
        width,
        background:
          "linear-gradient(90deg, var(--color-surface-2) 0%, var(--color-surface-3) 50%, var(--color-surface-2) 100%)",
        backgroundSize: "200% 100%",
        animation: "ah-shimmer 1.4s linear infinite",
      }}
    />
  );
}
