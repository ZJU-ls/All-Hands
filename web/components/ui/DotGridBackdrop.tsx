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
  const mask = fade
    ? "linear-gradient(to bottom, black 0%, black 60%, transparent 100%)"
    : undefined;
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${className}`}
    >
      {/* base dot grid · uses border token for calm neutrality */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-border) 1px, transparent 1px)",
          backgroundSize: `${size}px ${size}px`,
          opacity: safeOpacity,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
      {/* soft primary hotspot · anchors hero compositions without breaking the
          "颜色密度 ≤ 3" guard (uses primary-muted, a transparency preset) */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(600px circle at 20% 0%, var(--color-primary-muted), transparent 60%)",
          opacity: fade ? 0.5 : 0,
        }}
      />
    </div>
  );
}
