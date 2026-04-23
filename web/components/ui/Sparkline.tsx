"use client";

/**
 * Sparkline · Micro-viz primitive · §10.1
 *
 * Pure SVG, stroke = currentColor (or override via className). No fills,
 * no gradients, no libraries. Shape values are normalised 0..1 along Y
 * (0 = bottom, 1 = top); the component maps them into viewBox space.
 *
 * Usage:
 *   <Sparkline values={[0.2, 0.4, 0.3, 0.6, 0.9]} className="text-primary" />
 */

export function Sparkline({
  values,
  height = 24,
  className = "",
  strokeWidth = 1.5,
  showEndpoint = true,
  filled = false,
  ariaLabel,
}: {
  values: number[];
  height?: number;
  className?: string;
  strokeWidth?: number;
  showEndpoint?: boolean;
  /**
   * Paint a soft area fill underneath the stroke (primary-soft tint).
   * Off by default to preserve the minimal glyph style.
   */
  filled?: boolean;
  ariaLabel?: string;
}) {
  if (values.length < 2) {
    return (
      <svg
        viewBox="0 0 100 32"
        className={`w-full text-text-subtle ${className}`}
        style={{ height }}
        aria-hidden={ariaLabel ? undefined : true}
        aria-label={ariaLabel}
        role={ariaLabel ? "img" : undefined}
      >
        <line
          x1="0"
          y1="16"
          x2="100"
          y2="16"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth={strokeWidth}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 32 - Math.max(0, Math.min(1, v)) * 32;
    return [x, y] as const;
  });

  const polyPoints = pts
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  const areaPath = `${polyPoints} 100,32 0,32`;

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{ height }}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
    >
      {filled && (
        <polygon
          points={areaPath}
          fill="currentColor"
          fillOpacity="0.12"
          stroke="none"
        />
      )}
      {/* baseline · drawn first so the stroke overlays cleanly */}
      <line
        x1={first[0]}
        y1="32"
        x2={last[0]}
        y2="32"
        stroke="currentColor"
        strokeOpacity="0.12"
        strokeWidth="1"
      />
      <polyline
        points={polyPoints}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {showEndpoint && (
        <>
          <circle
            cx={last[0]}
            cy={last[1]}
            r="3"
            fill="currentColor"
            fillOpacity="0.2"
          />
          <circle cx={last[0]} cy={last[1]} r="1.75" fill="currentColor" />
        </>
      )}
    </svg>
  );
}
