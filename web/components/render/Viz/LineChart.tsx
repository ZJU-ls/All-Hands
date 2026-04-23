"use client";

import { useMemo } from "react";
import type { RenderProps } from "@/lib/component-registry";

// Multi-series charts use the ADR-0012 data-viz palette so each series is
// visually distinct by hue (the old one-hue-with-opacity approach read as
// grey soup for 3+ series). Palette stable-ordered; series cycle by index.
const SERIES_COLORS = [
  "var(--color-viz-1)",
  "var(--color-viz-2)",
  "var(--color-viz-3)",
  "var(--color-viz-4)",
];

const VB_W = 480;
const VB_H = 160;
const PAD_L = 32;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 24;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

type NormalizedSeries = {
  label: string;
  values: number[];
};

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeSeriesItem(item: Record<string, unknown>): NormalizedSeries {
  const valuesSource =
    Array.isArray(item.values)
      ? item.values
      : Array.isArray(item.data)
        ? item.data
        : Array.isArray(item.points)
          ? item.points
          : [];

  const values = valuesSource
    .map((point) => {
      if (point && typeof point === "object" && "y" in (point as Record<string, unknown>)) {
        return parseNumber((point as Record<string, unknown>).y);
      }
      return parseNumber(point);
    })
    .filter((v): v is number => v != null);

  return {
    label: typeof item.label === "string" ? item.label : "",
    values,
  };
}

export function LineChart({ props }: RenderProps) {
  const rawX = Array.isArray(props.x) ? (props.x as (string | number)[]) : undefined;
  const rawSeries = Array.isArray(props.series)
    ? (props.series as unknown[])
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map(normalizeSeriesItem)
    : undefined;
  const y_label = typeof props.y_label === "string" ? props.y_label : undefined;
  const caption = typeof props.caption === "string" ? props.caption : undefined;

  const { paths, areas, dots, yTicks, xLabels, series } = useMemo(() => {
    const series = (rawSeries ?? []).filter((s) => s.values.length > 0);
    const inferredLength = Math.max(0, ...series.map((s) => s.values.length));
    const x =
      rawX && rawX.length > 0
        ? rawX
        : Array.from({ length: inferredLength }, (_, i) => i + 1);
    const allValues = series.flatMap((s) => s.values);
    if (allValues.length === 0 || x.length === 0) {
      return {
        paths: [] as string[],
        areas: [] as string[],
        dots: [] as { cx: number; cy: number; seriesIdx: number }[],
        yTicks: [] as number[],
        xLabels: [] as string[],
        series,
      };
    }
    const yMin = Math.min(0, ...allValues);
    const yMax = Math.max(...allValues);
    const yRange = yMax - yMin || 1;

    const count = x.length;
    const xStep = count > 1 ? PLOT_W / (count - 1) : 0;
    const yBaseline = PAD_T + PLOT_H;

    const paths: string[] = [];
    const areas: string[] = [];
    const dots: { cx: number; cy: number; seriesIdx: number }[] = [];

    series.forEach((s, sIdx) => {
      if (s.values.length === 0) return;
      const seriesValues = s.values.slice(0, x.length);
      if (seriesValues.length === 0) return;
      const points = seriesValues.map((v, i) => {
        const px = PAD_L + i * xStep;
        const py = PAD_T + (1 - (v - yMin) / yRange) * PLOT_H;
        return { px, py };
      });
      paths.push(
        points
          .map(
            ({ px, py }, i) =>
              `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`,
          )
          .join(" "),
      );
      // Subtle area fill ONLY when 1-2 series, to add depth without turning
      // a 4-series chart into a Jackson Pollock.
      if (series.length <= 2) {
        const first = points[0]!;
        const last = points[points.length - 1]!;
        const linePart = points
          .map(
            ({ px, py }, i) =>
              `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`,
          )
          .join(" ");
        areas.push(
          `${linePart} L${last.px.toFixed(2)},${yBaseline.toFixed(2)} L${first.px.toFixed(2)},${yBaseline.toFixed(2)} Z`,
        );
      }
      // Dots only on the final data point so the chart has a clear "last
      // reading" anchor without cluttering. For short series (≤ 8), dot
      // every point.
      if (points.length <= 8) {
        for (const { px, py } of points) {
          dots.push({ cx: px, cy: py, seriesIdx: sIdx });
        }
      } else {
        const tail = points[points.length - 1]!;
        dots.push({ cx: tail.px, cy: tail.py, seriesIdx: sIdx });
      }
    });

    const tickCount = 3;
    const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
      return yMin + ((yMax - yMin) * i) / tickCount;
    });

    // Thin out x-axis labels for crowded domains
    const stride = Math.max(1, Math.ceil(count / 6));
    const xLabels = x.map((v, i) =>
      i === 0 || i === count - 1 || i % stride === 0 ? String(v) : "",
    );

    return { paths, areas, dots, yTicks, xLabels, series };
  }, [rawX, rawSeries]);

  if (paths.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-bg p-3 text-xs text-text-muted">
        No series
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-bg p-3" style={{ animation: "ah-fade-up var(--dur-mid) var(--ease-out)" }}>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full h-auto"
        role="img"
        aria-label={y_label ? `line chart: ${y_label}` : "line chart"}
      >
        {/* y grid + axis labels */}
        {yTicks.map((t, i) => {
          const py = PAD_T + (1 - i / (yTicks.length - 1)) * PLOT_H;
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                y1={py}
                x2={VB_W - PAD_R}
                y2={py}
                stroke="currentColor"
                strokeOpacity="0.12"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PAD_L - 6}
                y={py + 3}
                fontSize="9"
                textAnchor="end"
                className="fill-text-muted"
              >
                {t.toFixed(Math.abs(t) < 10 ? 1 : 0)}
              </text>
            </g>
          );
        })}
        {/* x labels */}
        {xLabels.map((label, i) => {
          if (!label) return null;
          const count = xLabels.length;
          const xStep = count > 1 ? PLOT_W / (count - 1) : 0;
          const px = PAD_L + i * xStep;
          return (
            <text
              key={i}
              x={px}
              y={VB_H - 6}
              fontSize="9"
              textAnchor="middle"
              className="fill-text-muted"
            >
              {label}
            </text>
          );
        })}
        {/* area fills (≤ 2 series only — adds depth without clutter) */}
        {areas.map((d, i) => (
          <path
            key={`a-${i}`}
            d={d}
            fill={SERIES_COLORS[i % SERIES_COLORS.length]}
            fillOpacity="0.08"
            stroke="none"
          />
        ))}
        {/* series paths */}
        {paths.map((d, i) => (
          <path
            key={`l-${i}`}
            d={d}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth="1.75"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* endpoint / data dots (halo + core) */}
        {dots.map((d, i) => (
          <g key={`d-${i}`}>
            <circle
              cx={d.cx}
              cy={d.cy}
              r="4"
              fill={SERIES_COLORS[d.seriesIdx % SERIES_COLORS.length]}
              fillOpacity="0.18"
            />
            <circle
              cx={d.cx}
              cy={d.cy}
              r="2"
              fill={SERIES_COLORS[d.seriesIdx % SERIES_COLORS.length]}
            />
          </g>
        ))}
      </svg>
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          {series.map((s, i) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-[2px] w-3 rounded-sm"
                style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {caption && (
        <div className="mt-2 text-xs text-text-muted">{caption}</div>
      )}
    </div>
  );
}
