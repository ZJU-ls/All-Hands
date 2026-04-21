"use client";

/**
 * DotGridBackdrop · §10.2
 *
 * Decorative radial-dot background for hero regions, empty states, and
 * onboarding screens. Static — no pan/rotate animation (§0.3 no-infinite-
 * animation rule). Opacity capped at 0.4 by contract; default 0.35.
 *
 * Absolute-positioned; put inside a `relative` container.
 */

export function DotGridBackdrop({
  size = 16,
  opacity = 0.35,
  fade = true,
  className = "",
}: {
  size?: number;
  opacity?: number;
  /** Whether to fade the dots toward the bottom (hero effect). */
  fade?: boolean;
  className?: string;
}) {
  const safeOpacity = Math.min(0.4, Math.max(0, opacity));
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        backgroundImage:
          "radial-gradient(var(--color-border) 1px, transparent 1px)",
        backgroundSize: `${size}px ${size}px`,
        opacity: safeOpacity,
        maskImage: fade
          ? "linear-gradient(to bottom, black 0%, black 60%, transparent 100%)"
          : undefined,
        WebkitMaskImage: fade
          ? "linear-gradient(to bottom, black 0%, black 60%, transparent 100%)"
          : undefined,
      }}
    />
  );
}
