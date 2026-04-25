"use client";

/**
 * AllhandsLogo · primary brand mark — 5 concept variants for review.
 *
 * Concepts:
 *   - "constellation"  · 1 lead + 4 satellites with hairline connectors.
 *                         Story: Lead Agent orchestrates a team.
 *   - "spark"          · 4-armed gradient starburst + center disc.
 *                         Story: agent intelligence radiating outward.
 *   - "cluster"        · honeycomb of 7 nodes (1 big + 6 small).
 *                         Story: a collective, not just a node.
 *   - "halo"           · minimal outer ring + center dot, premium-quiet.
 *                         Story: focused, deliberate, calm operator.
 *   - "pulse"          · concentric broadcast rings around a center node.
 *                         Story: signal, dispatch, real-time orchestration.
 *
 * Brand-identity glyphs are exempted from §3.8 colour discipline (same
 * exception as provider/model marks). Tile variants use the brand
 * gradient (primary → accent) directly via `var()`-resolved stops.
 *
 * Sizing: pass `size` (px). 32-unit viewBox internally so all proportions
 * scale linearly; favicon ships at 32, sidebar at 32, hero at 36-44.
 */

import { cn } from "@/lib/cn";

export type LogoConcept =
  | "constellation"
  | "spark"
  | "cluster"
  | "halo"
  | "pulse";

type Props = {
  size?: number;
  className?: string;
  variant?: "tile" | "mono";
  concept?: LogoConcept;
};

const TILE_GRAD_ID = "ahg-tile";
const TILE_GLOW_ID = "ahg-glow";

export function AllhandsLogo({
  size = 28,
  className,
  variant = "tile",
  concept = "constellation",
}: Props) {
  const renderInner = INNER_RENDERERS[concept];
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
          cy="13"
          r="15"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="white" stopOpacity="0.32" />
          <stop offset="65%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>

      {variant === "tile" ? (
        <>
          <rect width="32" height="32" rx="8" fill={`url(#${TILE_GRAD_ID})`} />
          <rect width="32" height="32" rx="8" fill={`url(#${TILE_GLOW_ID})`} />
        </>
      ) : null}

      {renderInner(variant === "tile")}
    </svg>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Inner renderers — one per concept. Each receives `tile` (true if drawing
// on top of the gradient tile, white inks) so mono outline mode can swap to
// currentColor for dense / dark surfaces without duplicating geometry.
// ───────────────────────────────────────────────────────────────────────────

type InnerRenderer = (tile: boolean) => React.ReactNode;

const ink = (tile: boolean, opacity = 1) =>
  tile ? `rgba(255,255,255,${opacity})` : "currentColor";

const constellation: InnerRenderer = (tile) => (
  <>
    <g
      stroke={ink(tile, 0.32)}
      strokeWidth={tile ? 0.6 : 0.8}
      strokeLinecap="round"
    >
      <line x1="16" y1="16" x2="16" y2="8" />
      <line x1="16" y1="16" x2="24" y2="16" />
      <line x1="16" y1="16" x2="16" y2="24" />
      <line x1="16" y1="16" x2="8" y2="16" />
    </g>
    <g fill={ink(tile, 0.78)}>
      <circle cx="16" cy="8" r="1.7" />
      <circle cx="24" cy="16" r="1.7" />
      <circle cx="16" cy="24" r="1.7" />
      <circle cx="8" cy="16" r="1.7" />
    </g>
    <circle cx="16" cy="16" r="4" fill={ink(tile)} />
  </>
);

const spark: InnerRenderer = (tile) => (
  <>
    {/* 4 diamond rays */}
    <g fill={ink(tile, 0.85)}>
      <path d="M16 4 L18 14 L16 16 L14 14 Z" />
      <path d="M28 16 L18 18 L16 16 L18 14 Z" />
      <path d="M16 28 L14 18 L16 16 L18 18 Z" />
      <path d="M4 16 L14 14 L16 16 L14 18 Z" />
    </g>
    <circle cx="16" cy="16" r="2.6" fill={ink(tile)} />
  </>
);

const cluster: InnerRenderer = (tile) => {
  // Honeycomb-ish cluster: one big in the middle, 6 small around at hex angles.
  const R = 6.6; // satellite radius from center
  const small = 1.55;
  const angles = [0, 60, 120, 180, 240, 300]; // degrees
  return (
    <>
      <g fill={ink(tile, 0.7)}>
        {angles.map((a) => {
          const rad = ((a - 90) * Math.PI) / 180;
          const cx = 16 + R * Math.cos(rad);
          const cy = 16 + R * Math.sin(rad);
          return <circle key={a} cx={cx} cy={cy} r={small} />;
        })}
      </g>
      <circle cx="16" cy="16" r="3.4" fill={ink(tile)} />
    </>
  );
};

const halo: InnerRenderer = (tile) => (
  <>
    {/* Outer dashed ring · slow rhythm, premium-quiet */}
    <circle
      cx="16"
      cy="16"
      r="10"
      fill="none"
      stroke={ink(tile, 0.55)}
      strokeWidth={tile ? 1.2 : 1.4}
      strokeDasharray="2 3.4"
      strokeLinecap="round"
    />
    {/* Inner soft ring */}
    <circle
      cx="16"
      cy="16"
      r="6.2"
      fill="none"
      stroke={ink(tile, 0.28)}
      strokeWidth={tile ? 0.8 : 1}
    />
    <circle cx="16" cy="16" r="3.2" fill={ink(tile)} />
  </>
);

const pulse: InnerRenderer = (tile) => (
  <>
    <circle
      cx="16"
      cy="16"
      r="12"
      fill="none"
      stroke={ink(tile, 0.16)}
      strokeWidth={tile ? 1 : 1.2}
    />
    <circle
      cx="16"
      cy="16"
      r="8"
      fill="none"
      stroke={ink(tile, 0.34)}
      strokeWidth={tile ? 1 : 1.2}
    />
    <circle
      cx="16"
      cy="16"
      r="4.2"
      fill="none"
      stroke={ink(tile, 0.6)}
      strokeWidth={tile ? 1 : 1.2}
    />
    <circle cx="16" cy="16" r="2.2" fill={ink(tile)} />
  </>
);

const INNER_RENDERERS: Record<LogoConcept, InnerRenderer> = {
  constellation,
  spark,
  cluster,
  halo,
  pulse,
};

/**
 * AllhandsWordmark — companion typographic mark.
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

/** Concept metadata for the gallery page. */
export const LOGO_CONCEPTS: Array<{
  id: LogoConcept;
  name: string;
  story: string;
}> = [
  {
    id: "constellation",
    name: "Constellation · 星座",
    story: "Lead 居中 · 4 名员工环绕 · hairline 暗示编排关系。",
  },
  {
    id: "spark",
    name: "Spark · 光芒",
    story: "4 道菱形光束从中心发散 · 智能向外辐射。",
  },
  {
    id: "cluster",
    name: "Cluster · 集群",
    story: "蜂窝 7 节点 · 强调「群体」,而非「枢纽」。",
  },
  {
    id: "halo",
    name: "Halo · 光环",
    story: "外环虚线 + 中心点 · 极简、克制、像 watch face。",
  },
  {
    id: "pulse",
    name: "Pulse · 脉冲",
    story: "三层同心环 · 信号广播 · 实时调度的视觉隐喻。",
  },
];
