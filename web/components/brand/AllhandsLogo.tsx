"use client";

/**
 * AllhandsLogo · primary brand mark — premium concept exploration.
 *
 * Concepts (premium tier · v2):
 *   - "aperture"   · 6-blade camera aperture rotating around a pinhole.
 *                     Story: focus, lens, precision under load.
 *   - "origami"    · single diagonal fold on a brand-gradient tile —
 *                     two "faces" of one platform.
 *                     Story: depth, reveal, paper-fold craft.
 *   - "bracket"    · two angle brackets embracing a center node.
 *                     Story: structured + protected (護欄/编排隐喻).
 *   - "stack"      · 3 isometric tiles forming a layered platform.
 *                     Story: 10-layer architecture, depth, foundation.
 *   - "orbit"      · a tilted orbital ring with a satellite + lead node.
 *                     Story: orchestration, system motion, hierarchy.
 *
 * Brand-identity glyphs are exempted from §3.8 colour discipline (same
 * exception as provider/model marks). Tile variants use the brand
 * gradient (primary → accent) directly via `var()`-resolved stops.
 *
 * Sizing: 32-unit viewBox internally. Favicon 32 · sidebar 32 · hero 36-44.
 */

import { cn } from "@/lib/cn";

export type LogoConcept =
  | "aperture"
  | "origami"
  | "bracket"
  | "stack"
  | "orbit"
  // legacy alias kept so existing constellation refs don't crash; renders
  // the closest premium replacement (`orbit`).
  | "constellation";

type Props = {
  size?: number;
  className?: string;
  variant?: "tile" | "mono";
  concept?: LogoConcept;
};

const TILE_GRAD_ID = "ahg-tile";
const TILE_GLOW_ID = "ahg-glow";
const FOLD_GRAD_ID = "ahg-fold";

export function AllhandsLogo({
  size = 28,
  className,
  variant = "tile",
  concept = "aperture",
}: Props) {
  const resolved = concept === "constellation" ? "orbit" : concept;
  const renderInner = INNER_RENDERERS[resolved];
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
        {/* Used by origami fold to darken the bottom-right face */}
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
// Inner renderers — each receives `tile` (drawing on top of gradient).
// ───────────────────────────────────────────────────────────────────────────

type InnerRenderer = (tile: boolean) => React.ReactNode;

const ink = (tile: boolean, opacity = 1) =>
  tile ? `rgba(255,255,255,${opacity})` : "currentColor";

// ─── 1. APERTURE · 6-blade radial geometry ────────────────────────────────
//
// 6 wedges meeting around a central pinhole. Each wedge is a quadrilateral
// computed parametrically: outer arc + inner offset gives the classic
// aperture-blade slant (not just simple triangles — that would read as a
// pinwheel). Subtle alpha variation across blades gives a sense of depth.

const aperture: InnerRenderer = (tile) => {
  const cx = 16;
  const cy = 16;
  const outerR = 12;
  const innerR = 4.4;
  const blades: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * 60 * Math.PI) / 180;
    // Each blade spans a 60° arc, with an offset so blades overlap subtly.
    const a1 = a - Math.PI / 6;
    const a2 = a + Math.PI / 6;
    const a3 = a + Math.PI / 3.4;
    // Outer arc points + inner pivot · forms the blade wedge.
    const p = (r: number, ang: number) =>
      `${(cx + r * Math.cos(ang)).toFixed(2)},${(cy + r * Math.sin(ang)).toFixed(2)}`;
    blades.push(
      `M ${p(innerR, a1)} L ${p(outerR, a1)} L ${p(outerR, a2)} L ${p(outerR * 0.92, a3)} Z`,
    );
  }
  return (
    <>
      {blades.map((d, i) => (
        <path
          key={i}
          d={d}
          fill={ink(tile, 0.55 + ((i % 3) * 0.12))}
        />
      ))}
      {/* Pinhole · slightly recessed, with a faint inner ring */}
      <circle cx="16" cy="16" r="3.4" fill={ink(tile, tile ? 1 : 0.96)} />
      <circle
        cx="16"
        cy="16"
        r="3.4"
        fill="none"
        stroke={ink(tile, 0.18)}
        strokeWidth="0.6"
      />
    </>
  );
};

// ─── 2. ORIGAMI · single diagonal fold ────────────────────────────────────
//
// A clean fold from upper-left toward lower-right. The bottom-right face
// is darkened with a black-stop overlay (FOLD_GRAD_ID) so the tile reads
// as paper, not a flat gradient. Mono variant shows just the seam line +
// subtle face shading via stroke.

const origami: InnerRenderer = (tile) => {
  if (!tile) {
    // Mono: outline of square + diagonal seam · minimal but recognisable.
    return (
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
        />
        <circle cx="13" cy="20" r="1.5" fill="currentColor" />
      </>
    );
  }
  return (
    <>
      {/* Bottom-right face · darkened triangle, clipped to the tile */}
      <path
        d="M 7 11 L 25 29 L 32 32 L 32 0 Z"
        fill={`url(#${FOLD_GRAD_ID})`}
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
      />
      {/* Wordless mark in the larger face — a single bright disc — gives the
          tile a focal point so it reads as deliberate at any size. */}
      <circle cx="12.5" cy="19.5" r="2.2" fill="white" fillOpacity="0.92" />
    </>
  );
};

// ─── 3. BRACKET · code-bracket embrace ────────────────────────────────────
//
// Two angled brackets `〈 • 〉` flanking a center disc. Code/structure
// vibe. The brackets are stroked (round caps) for a confident weight that
// holds at small sizes.

const bracket: InnerRenderer = (tile) => (
  <>
    <g
      stroke={ink(tile, 0.92)}
      strokeWidth={tile ? 2 : 2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    >
      {/* Left bracket */}
      <polyline points="11,7 6,16 11,25" />
      {/* Right bracket */}
      <polyline points="21,7 26,16 21,25" />
    </g>
    {/* Center node · bold disc, slightly larger than the bracket vertices */}
    <circle cx="16" cy="16" r="2.6" fill={ink(tile)} />
  </>
);

// ─── 4. STACK · isometric layered tiles ───────────────────────────────────
//
// 3 stacked rounded squares at slight offsets, decreasing opacity from
// front to back · reads as "platform with depth, layered architecture".
// Strictly 2D (no projection) so the mark scales cleanly to 16px.

const stack: InnerRenderer = (tile) => (
  <>
    {/* Back tile */}
    <rect
      x="9"
      y="5"
      width="14"
      height="14"
      rx="3"
      fill={ink(tile, 0.32)}
    />
    {/* Middle tile */}
    <rect
      x="6"
      y="9"
      width="14"
      height="14"
      rx="3"
      fill={ink(tile, 0.55)}
    />
    {/* Front tile */}
    <rect
      x="3"
      y="13"
      width="14"
      height="14"
      rx="3"
      fill={ink(tile)}
    />
    {/* Subtle separator hairlines · only on tile variant where contrast helps */}
    {tile ? (
      <g stroke="white" strokeOpacity="0.22" strokeWidth="0.5">
        <rect x="9" y="5" width="14" height="14" rx="3" fill="none" />
        <rect x="6" y="9" width="14" height="14" rx="3" fill="none" />
      </g>
    ) : null}
  </>
);

// ─── 5. ORBIT · tilted ring + satellite + lead node ───────────────────────
//
// A 30°-rotated ellipse with a single satellite riding on it and a lead
// node at the center. Orchestration as gravitational system. The tilted
// ellipse is what makes this read as motion rather than a static circle.

const orbit: InnerRenderer = (tile) => (
  <>
    <ellipse
      cx="16"
      cy="16"
      rx="11"
      ry="4.5"
      fill="none"
      stroke={ink(tile, 0.7)}
      strokeWidth={tile ? 1.2 : 1.4}
      transform="rotate(-28 16 16)"
    />
    {/* Satellite · positioned on the orbital path (precomputed) */}
    <circle cx="24.5" cy="11.6" r="1.7" fill={ink(tile, 0.92)} />
    {/* Lead node · bright center disc with a subtle ring for hierarchy */}
    <circle cx="16" cy="16" r="3.6" fill={ink(tile)} />
    <circle
      cx="16"
      cy="16"
      r="3.6"
      fill="none"
      stroke={ink(tile, 0.22)}
      strokeWidth="0.6"
    />
  </>
);

const INNER_RENDERERS: Record<Exclude<LogoConcept, "constellation">, InnerRenderer> = {
  aperture,
  origami,
  bracket,
  stack,
  orbit,
};

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

/** Concept metadata for the gallery page. */
export const LOGO_CONCEPTS: Array<{
  id: Exclude<LogoConcept, "constellation">;
  name: string;
  story: string;
}> = [
  {
    id: "aperture",
    name: "Aperture · 光圈",
    story: "六叶光圈 + 中心针孔 · 像相机镜头 · 暗示「聚焦」与「精确调度」。",
  },
  {
    id: "origami",
    name: "Origami · 折纸",
    story: "对角线一折 · 两个面对照 · 平台「展开」的瞬间 · 有纸感的高级。",
  },
  {
    id: "bracket",
    name: "Bracket · 括号",
    story: "两侧尖括号拥抱中心节点 · 代码 / 护栏 / 编排的视觉同构。",
  },
  {
    id: "stack",
    name: "Stack · 层叠",
    story: "三块圆角瓦片错位叠放 · 10 层架构的几何隐喻 · 平台感强。",
  },
  {
    id: "orbit",
    name: "Orbit · 轨道",
    story: "倾斜椭圆 + 中心 lead + 一颗卫星 · 编排即引力系统。",
  },
];
