"use client";

/**
 * AllhandsLogo · primary brand mark.
 *
 * Concept: Lead Agent at the center, 4 employee nodes around it — the
 * platform's whole story compressed into a 32-unit glyph. Brand-blue
 * gradient tile (primary → accent) hosts a bright center disc and four
 * lighter satellites; subtle hairlines hint at the orchestration.
 *
 * Inherits `currentColor` is *not* used here on purpose — brand identity
 * glyphs are the carved-out exception in design §3.8 (same exception as
 * provider/model marks). Light / dark adapt by living on the same gradient
 * regardless of theme.
 *
 * Sizing: pass `size` (px) — keeps a 32-unit viewBox so all internal
 * dimensions scale linearly. Companion <AllhandsWordmark> for the
 * lockup; combine with a flex row for the full logo.
 */

import { cn } from "@/lib/cn";

type Props = {
  size?: number;
  className?: string;
  /** Render without the gradient tile (mono outline · for dense surfaces). */
  variant?: "tile" | "mono";
};

export function AllhandsLogo({
  size = 28,
  className,
  variant = "tile",
}: Props) {
  if (variant === "mono") {
    return <MonoMark size={size} className={className} />;
  }
  return <TileMark size={size} className={className} />;
}

function TileMark({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="allhands"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id="ahg-tile" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          {/* SVG <stop> doesn't resolve `var()` from the `stop-color`
              attribute in every renderer; use inline `style` so the CSS
              cascade resolves the token reliably. */}
          <stop offset="0%" style={{ stopColor: "var(--color-primary)" }} />
          <stop offset="100%" style={{ stopColor: "var(--color-accent)" }} />
        </linearGradient>
        <radialGradient
          id="ahg-glow"
          cx="16"
          cy="16"
          r="14"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="white" stopOpacity="0.35" />
          <stop offset="60%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Tile · brand gradient · rounded square */}
      <rect x="0" y="0" width="32" height="32" rx="8" fill="url(#ahg-tile)" />
      {/* Inner highlight glow · gives the mark dimension at hero sizes */}
      <rect x="0" y="0" width="32" height="32" rx="8" fill="url(#ahg-glow)" />

      {/* Hairline connectors · center → 4 satellites */}
      <g stroke="white" strokeOpacity="0.32" strokeWidth="0.6" strokeLinecap="round">
        <line x1="16" y1="16" x2="16" y2="8" />
        <line x1="16" y1="16" x2="24" y2="16" />
        <line x1="16" y1="16" x2="16" y2="24" />
        <line x1="16" y1="16" x2="8" y2="16" />
      </g>

      {/* 4 satellite nodes · cardinal positions */}
      <g fill="white" fillOpacity="0.78">
        <circle cx="16" cy="8" r="1.7" />
        <circle cx="24" cy="16" r="1.7" />
        <circle cx="16" cy="24" r="1.7" />
        <circle cx="8" cy="16" r="1.7" />
      </g>

      {/* Center node · Lead Agent · larger + ring */}
      <circle cx="16" cy="16" r="4" fill="white" />
      <circle cx="16" cy="16" r="4" fill="url(#ahg-tile)" fillOpacity="0.18" />
    </svg>
  );
}

function MonoMark({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="allhands"
      className={cn("shrink-0", className)}
    >
      <g stroke="currentColor" strokeOpacity="0.45" strokeWidth="0.8" strokeLinecap="round">
        <line x1="16" y1="16" x2="16" y2="8" />
        <line x1="16" y1="16" x2="24" y2="16" />
        <line x1="16" y1="16" x2="16" y2="24" />
        <line x1="16" y1="16" x2="8" y2="16" />
      </g>
      <g fill="currentColor" fillOpacity="0.7">
        <circle cx="16" cy="8" r="1.8" />
        <circle cx="24" cy="16" r="1.8" />
        <circle cx="16" cy="24" r="1.8" />
        <circle cx="8" cy="16" r="1.8" />
      </g>
      <circle cx="16" cy="16" r="3.6" fill="currentColor" />
    </svg>
  );
}

/**
 * AllhandsWordmark — companion typographic mark for headers and the welcome
 * lockup. Inter-driven (matches body type) with a subtle accent dot on the
 * second 'h' so the logotype reads as deliberate, not just typed.
 */
export function AllhandsWordmark({
  className,
  size = 14,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex items-baseline font-semibold tracking-tight text-text",
        className,
      )}
      style={{ fontSize: size }}
    >
      allhands
      <span
        aria-hidden
        className="ml-[1px] inline-block h-[3px] w-[3px] translate-y-[-0.6em] rounded-full bg-primary"
      />
    </span>
  );
}
