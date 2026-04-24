/**
 * Product brand · allhands Logo
 *
 * Geometric mark: central hub + 4 cardinal satellites connected by
 * hairlines. The hub carries a fixed primary → accent gradient; the
 * satellites and rays use `currentColor` so the caller controls contrast
 * via Tailwind `text-*` utilities (e.g. `text-primary` on surfaces,
 * `text-primary-fg` inside a filled primary chip).
 *
 * Variants:
 *   mark      — 24x24 glyph only (favicon, workspace chip, avatars)
 *   wordmark  — "allhands" sans, tracking-tight lowercase
 *   full      — mark + wordmark horizontal (welcome hero, auth)
 *
 * Do not introduce a raster variant. Scales from 14px (sidebar) to
 * 96px (welcome hero) on the same source.
 */
import { clsx } from "clsx";

export type LogoVariant = "mark" | "wordmark" | "full";

type LogoProps = {
  variant?: LogoVariant;
  /** Height in px for mark / full; wordmark auto-scales to match. */
  size?: number;
  /** When true, the hub uses currentColor instead of the fixed gradient.
   *  Enable inside chips/buttons whose background is already primary. */
  monochrome?: boolean;
  className?: string;
  /** Override wordmark text (defaults to "allhands"). */
  label?: string;
};

export function Logo({
  variant = "full",
  size = 24,
  monochrome = false,
  className,
  label = "allhands",
}: LogoProps) {
  if (variant === "wordmark") {
    return (
      <span
        className={clsx(
          "font-semibold tracking-tight leading-none",
          className,
        )}
        style={{ fontSize: size * 0.8 }}
      >
        {label}
      </span>
    );
  }

  const mark = <LogoMark size={size} monochrome={monochrome} />;
  if (variant === "mark") {
    return <span className={className}>{mark}</span>;
  }

  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      {mark}
      <span
        className="font-semibold tracking-tight leading-none"
        style={{ fontSize: size * 0.72 }}
      >
        {label}
      </span>
    </span>
  );
}

function LogoMark({
  size,
  monochrome,
}: {
  size: number;
  monochrome: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="allhands"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* connecting rays — hub to each satellite. currentColor @ 32% so
           the structure reads but the dots dominate. */}
      <g
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.35"
      >
        <line x1="12" y1="12" x2="12" y2="4" />
        <line x1="12" y1="12" x2="20" y2="12" />
        <line x1="12" y1="12" x2="12" y2="20" />
        <line x1="12" y1="12" x2="4" y2="12" />
      </g>
      {/* 4 cardinal satellites — filled currentColor */}
      <g fill="currentColor">
        <circle cx="12" cy="4" r="2" />
        <circle cx="20" cy="12" r="2" />
        <circle cx="12" cy="20" r="2" />
        <circle cx="4" cy="12" r="2" />
      </g>
      {/* central hub — gradient unless monochrome */}
      {monochrome ? (
        <circle cx="12" cy="12" r="4" fill="currentColor" />
      ) : (
        <>
          <circle cx="12" cy="12" r="4" fill="url(#allhands-logo-hub)" />
          <defs>
            <linearGradient
              id="allhands-logo-hub"
              x1="0"
              y1="0"
              x2="1"
              y2="1"
            >
              <stop
                offset="0"
                style={{ stopColor: "var(--color-primary)" }}
              />
              <stop
                offset="1"
                style={{ stopColor: "var(--color-accent)" }}
              />
            </linearGradient>
          </defs>
        </>
      )}
    </svg>
  );
}
