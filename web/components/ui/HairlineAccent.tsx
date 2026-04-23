"use client";

/**
 * HairlineAccent · §10.3
 *
 * 1px decorative primary-gradient line. Used to mark "featured / default /
 * recommended" surfaces. Does NOT replace the 2px activation bar (§2.1),
 * which is a state indicator, not decoration.
 *
 * Absolute-positioned; put inside a `relative` container (eg. a card).
 */

export function HairlineAccent({
  position = "top",
  opacity = 0.2,
  className = "",
}: {
  position?: "top" | "left";
  /** Clamped to [0, 0.25] per §10.3. */
  opacity?: number;
  className?: string;
}) {
  const safeOpacity = Math.min(0.25, Math.max(0, opacity));
  // Three-stop gradient: dense primary fades through primary-muted to fully
  // transparent. Reads as a subtle glow, not a hard colored rule.
  const gradient = (direction: "to right" | "to bottom") =>
    `linear-gradient(${direction}, var(--color-primary), var(--color-primary-muted) 45%, transparent)`;

  if (position === "left") {
    return (
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-px ${className}`}
        style={{
          background: gradient("to bottom"),
          opacity: safeOpacity,
        }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 top-0 h-px ${className}`}
      style={{
        background: gradient("to right"),
        opacity: safeOpacity,
      }}
    />
  );
}
