"use client";

/**
 * AllhandsLogo · primary brand mark · "origami" concept (locked v2).
 *
 * A single diagonal fold across a brand-gradient tile. The bottom-right
 * face is darkened by an overlay, the seam is a soft white hairline, and
 * a small bright disc anchors the larger face. The mark reads as paper —
 * deliberate, tactile — at any size from 16px favicon to 80px hero.
 *
 * Brand-identity glyphs are exempted from §3.8 colour discipline (same
 * exception as provider/model marks). The tile gradient resolves
 * `var(--color-primary|accent)` so light/dark themes follow the pack.
 *
 * Optional `animateIn` plays a fold-in entrance: the seam draws across,
 * the dark face slides in behind it, the disc fades up. Once. Used on
 * the welcome hero — opt-in elsewhere via prop.
 */

import { cn } from "@/lib/cn";

type Props = {
  size?: number;
  className?: string;
  /** Tile = brand gradient with white inks · mono = currentColor outline. */
  variant?: "tile" | "mono";
  /** Plays a one-shot fold-in entrance animation on mount. */
  animateIn?: boolean;
};

const TILE_GRAD_ID = "ahg-tile";
const TILE_GLOW_ID = "ahg-glow";
const FOLD_GRAD_ID = "ahg-fold";

export function AllhandsLogo({
  size = 28,
  className,
  variant = "tile",
  animateIn = false,
}: Props) {
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
        <linearGradient
          id={TILE_GRAD_ID}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" style={{ stopColor: "var(--color-primary)" }} />
          <stop offset="100%" style={{ stopColor: "var(--color-accent)" }} />
        </linearGradient>
        <radialGradient
          id={TILE_GLOW_ID}
          cx="16"
          cy="11"
          r="16"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="white" stopOpacity="0.34" />
          <stop offset="65%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id={FOLD_GRAD_ID}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="black" stopOpacity="0" />
          <stop offset="100%" stopColor="black" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      {variant === "tile" ? (
        <g className={animateIn ? "ah-fold-tile" : undefined}>
          <rect width="32" height="32" rx="8" fill={`url(#${TILE_GRAD_ID})`} />
          <rect width="32" height="32" rx="8" fill={`url(#${TILE_GLOW_ID})`} />
          {/* Bottom-right darker face · clipped to tile by rx=8 */}
          <path
            d="M 7 11 L 25 29 L 32 32 L 32 0 Z"
            fill={`url(#${FOLD_GRAD_ID})`}
            className={animateIn ? "ah-fold-face" : undefined}
            style={
              animateIn
                ? { transformOrigin: "16px 16px", transformBox: "fill-box" }
                : undefined
            }
          />
          {/* Fold seam · soft white hairline */}
          <line
            x1="7"
            y1="11"
            x2="25"
            y2="29"
            stroke="white"
            strokeOpacity="0.45"
            strokeWidth="1"
            strokeLinecap="round"
            className={animateIn ? "ah-fold-seam" : undefined}
            pathLength={1}
          />
          {/* Focal disc on the larger face */}
          <circle
            cx="12.5"
            cy="19.5"
            r="2.2"
            fill="white"
            fillOpacity="0.92"
            className={animateIn ? "ah-fold-disc" : undefined}
          />
          {/* Sweep highlight · a single bright streak crossing the seam,
              gives the fold a "paper just caught the light" moment. */}
          {animateIn ? (
            <line
              x1="7"
              y1="11"
              x2="25"
              y2="29"
              stroke="white"
              strokeOpacity="0.95"
              strokeWidth="2.6"
              strokeLinecap="round"
              className="ah-fold-sweep"
              pathLength={1}
            />
          ) : null}
        </g>
      ) : (
        // Mono · outline + seam · for dense / dark surfaces.
        <>
          <rect
            x="3"
            y="3"
            width="26"
            height="26"
            rx="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <line
            x1="7"
            y1="11"
            x2="25"
            y2="29"
            stroke="currentColor"
            strokeOpacity="0.6"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <circle cx="13" cy="20" r="1.5" fill="currentColor" />
        </>
      )}

      {animateIn ? (
        <style>{`
          @keyframes ah-fold-tile-in {
            0%   { opacity: 0; transform: scale(0.62) rotate(-8deg); }
            55%  { opacity: 1; transform: scale(1.04) rotate(2deg); }
            80%  { transform: scale(0.99) rotate(-0.8deg); }
            100% { opacity: 1; transform: scale(1) rotate(0deg); }
          }
          @keyframes ah-fold-seam-draw {
            from { stroke-dasharray: 0 1; }
            to   { stroke-dasharray: 1 0; }
          }
          @keyframes ah-fold-sweep {
            0%   { stroke-dasharray: 0 1; opacity: 0.95; }
            70%  { stroke-dasharray: 0.5 0.5; opacity: 0.95; }
            100% { stroke-dasharray: 1 0; opacity: 0; }
          }
          @keyframes ah-fold-face-in {
            from { opacity: 0; transform: translateX(8px); }
            to   { opacity: 1; transform: translateX(0); }
          }
          @keyframes ah-fold-disc-in {
            0%   { opacity: 0; transform: scale(0.3); }
            70%  { opacity: 0.92; transform: scale(1.25); }
            100% { opacity: 0.92; transform: scale(1); }
          }
          .ah-fold-tile {
            transform-origin: 16px 16px;
            transform-box: fill-box;
            animation: ah-fold-tile-in 900ms cubic-bezier(.34,1.4,.4,1) forwards;
          }
          .ah-fold-seam {
            stroke-dasharray: 0 1;
            animation: ah-fold-seam-draw 1100ms cubic-bezier(.2,.8,.2,1) 320ms forwards;
          }
          .ah-fold-sweep {
            stroke-dasharray: 0 1;
            opacity: 0;
            animation: ah-fold-sweep 1100ms cubic-bezier(.4,.0,.2,1) 320ms forwards;
          }
          .ah-fold-face {
            opacity: 0;
            animation: ah-fold-face-in 720ms cubic-bezier(.2,.8,.2,1) 880ms forwards;
          }
          .ah-fold-disc {
            opacity: 0;
            transform-origin: 12.5px 19.5px;
            transform-box: fill-box;
            animation: ah-fold-disc-in 600ms cubic-bezier(.34,1.6,.4,1) 1300ms forwards;
          }
          @media (prefers-reduced-motion: reduce) {
            .ah-fold-tile, .ah-fold-seam, .ah-fold-sweep, .ah-fold-face, .ah-fold-disc {
              animation: none;
              opacity: 1;
              stroke-dasharray: none;
              transform: none;
            }
            .ah-fold-sweep { opacity: 0; }
          }
        `}</style>
      ) : null}
    </svg>
  );
}

/** Companion typographic mark. */
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
