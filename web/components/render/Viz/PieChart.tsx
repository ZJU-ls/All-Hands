"use client";

import { useMemo } from "react";
import type { RenderProps } from "@/lib/component-registry";

type Slice = { label: string; value: number };
type Variant = "pie" | "donut";

// Each slice uses a distinct hue from the ADR-0012 palette. 6 is the
// schema max; palette cycles by slice index for stable ordering.
const SLICE_COLORS = [
  "var(--color-viz-1)",
  "var(--color-viz-2)",
  "var(--color-viz-3)",
  "var(--color-viz-4)",
  "var(--color-viz-5)",
  "var(--color-viz-6)",
];

const SIZE = 150;
const R = 64;
const INNER_R = 38;
const CX = SIZE / 2;
const CY = SIZE / 2;

function polarToCartesian(angle: number, radius: number): [number, number] {
  const x = CX + radius * Math.cos(angle - Math.PI / 2);
  const y = CY + radius * Math.sin(angle - Math.PI / 2);
  return [x, y];
}

function arcPath(startAngle: number, endAngle: number, variant: Variant): string {
  const [sx, sy] = polarToCartesian(startAngle, R);
  const [ex, ey] = polarToCartesian(endAngle, R);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  if (variant === "pie") {
    return `M${CX},${CY} L${sx.toFixed(2)},${sy.toFixed(2)} A${R},${R} 0 ${largeArc} 1 ${ex.toFixed(2)},${ey.toFixed(2)} Z`;
  }
  const [isx, isy] = polarToCartesian(endAngle, INNER_R);
  const [iex, iey] = polarToCartesian(startAngle, INNER_R);
  return `M${sx.toFixed(2)},${sy.toFixed(2)} A${R},${R} 0 ${largeArc} 1 ${ex.toFixed(2)},${ey.toFixed(2)} L${isx.toFixed(2)},${isy.toFixed(2)} A${INNER_R},${INNER_R} 0 ${largeArc} 0 ${iex.toFixed(2)},${iey.toFixed(2)} Z`;
}

/**
 * Brand-Blue V2 (ADR 0016) · pie / donut chart.
 *
 * Shell: rounded-xl · bg-surface · shadow-soft-sm.
 * Donut center shows the largest slice as a focal metric.
 */
export function PieChart({ props }: RenderProps) {
  const rawSlicesIn = props.slices;
  const rawSlices = useMemo<Slice[]>(() => {
    if (!Array.isArray(rawSlicesIn)) return [];
    return (rawSlicesIn as unknown[])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        label: typeof s.label === "string" ? s.label : "",
        value:
          typeof s.value === "number" && Number.isFinite(s.value)
            ? Math.max(0, s.value)
            : 0,
      }));
  }, [rawSlicesIn]);
  const variant: Variant = props.variant === "pie" ? "pie" : "donut";
  const title = typeof props.title === "string" ? props.title : undefined;
  const caption = typeof props.caption === "string" ? props.caption : undefined;

  const { arcs, total } = useMemo(() => {
    const slices = rawSlices;
    const total = slices.reduce((acc, s) => acc + Math.max(0, s.value), 0);
    if (total <= 0) {
      return { arcs: [] as { path: string; slice: Slice; pct: number }[], total: 0 };
    }
    let acc = 0;
    const arcs = slices.map((s) => {
      const v = Math.max(0, s.value);
      const start = (acc / total) * 2 * Math.PI;
      acc += v;
      const end = (acc / total) * 2 * Math.PI;
      const safeEnd = end === start ? start + 1e-4 : end;
      const path =
        slices.length === 1
          ? variant === "pie"
            ? `M${CX},${CY - R} A${R},${R} 0 1 1 ${(CX - 0.01).toFixed(2)},${CY - R} Z`
            : `M${CX},${CY - R} A${R},${R} 0 1 1 ${(CX - 0.01).toFixed(2)},${CY - R} L${CX - 0.01},${CY - INNER_R} A${INNER_R},${INNER_R} 0 1 0 ${CX},${CY - INNER_R} Z`
          : arcPath(start, safeEnd, variant);
      return { path, slice: s, pct: v / total };
    });
    return { arcs, total };
  }, [rawSlices, variant]);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-3 text-caption text-text-muted">
        No slices
      </div>
    );
  }

  // Focal metric for donut center — largest slice.
  const headline = arcs
    .map(({ slice, pct }, i) => ({ slice, pct, i }))
    .sort((a, b) => b.pct - a.pct)[0];

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm animate-fade-up">
      {title && (
        <div className="mb-3 text-sm font-medium text-text">{title}</div>
      )}
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            width={SIZE}
            height={SIZE}
            className="shrink-0"
            role="img"
            aria-label="pie chart"
          >
            {arcs.map(({ path }, i) => (
              <path
                key={i}
                d={path}
                fill={SLICE_COLORS[i % SLICE_COLORS.length]}
                stroke="var(--color-surface)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {variant === "donut" && headline && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="font-mono text-base font-bold tabular-nums"
                style={{
                  color: SLICE_COLORS[headline.i % SLICE_COLORS.length],
                }}
              >
                {(headline.pct * 100).toFixed(0)}%
              </span>
              <span className="text-caption font-mono uppercase tracking-wider text-text-subtle truncate max-w-[80px]">
                {headline.slice.label}
              </span>
            </div>
          )}
        </div>
        <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-caption">
          {arcs.map(({ slice, pct }, i) => (
            <li
              key={i}
              className="flex items-center gap-2 min-w-0 rounded-sm px-1 py-0.5 transition-colors duration-fast hover:bg-surface-2/60"
            >
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
              />
              <span className="truncate text-text">{slice.label}</span>
              <span className="ml-auto font-mono tabular-nums text-text-muted">
                {(pct * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
      {caption && (
        <div className="mt-3 text-caption font-mono text-text-muted">
          {caption}
        </div>
      )}
    </div>
  );
}
