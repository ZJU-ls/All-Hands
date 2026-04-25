"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { RenderProps } from "@/lib/component-registry";

const SERIES_COLORS = [
  "var(--color-viz-1)",
  "var(--color-viz-2)",
  "var(--color-viz-3)",
  "var(--color-viz-4)",
];

const VB_W = 480;
const VB_H = 180;
const PAD_L = 34;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 26;
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
  const valuesSource = Array.isArray(item.values)
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

/**
 * Brand-Blue V2 (ADR 0016) · line chart.
 *
 * Interactions (2026-04-25):
 *   - mouse-tracked vertical crosshair · snaps to nearest x index
 *   - per-series dot at the crosshair x · tooltip lists every visible
 *     series' value at that index
 *   - clickable legend · toggles a series' visibility
 */
export function LineChart({ props }: RenderProps) {
  const t = useTranslations("viz.lineChart");
  const rawX = Array.isArray(props.x) ? (props.x as (string | number)[]) : undefined;
  const rawSeries = Array.isArray(props.series)
    ? (props.series as unknown[])
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map(normalizeSeriesItem)
    : undefined;
  const title = typeof props.title === "string" ? props.title : undefined;
  const y_label = typeof props.y_label === "string" ? props.y_label : undefined;
  const caption = typeof props.caption === "string" ? props.caption : undefined;

  const [hidden, setHidden] = useState<Set<number>>(() => new Set());
  const [hoverX, setHoverX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  function toggleSeries(idx: number) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  const data = useMemo(() => {
    const series = (rawSeries ?? []).filter((s) => s.values.length > 0);
    const inferredLength = Math.max(0, ...series.map((s) => s.values.length));
    const x =
      rawX && rawX.length > 0
        ? rawX
        : Array.from({ length: inferredLength }, (_, i) => i + 1);

    // Only visible series contribute to y-range so toggling rescales.
    const visibleSeries = series.filter((_, i) => !hidden.has(i));
    const visibleValues = visibleSeries.flatMap((s) => s.values);
    if (visibleValues.length === 0 || x.length === 0) {
      return {
        paths: [] as { d: string; idx: number }[],
        areas: [] as { d: string; idx: number }[],
        seriesPoints: [] as { idx: number; pts: { px: number; py: number; v: number }[] }[],
        yTicks: [] as number[],
        xLabels: [] as string[],
        series,
        x,
        xStep: 0,
      };
    }
    const yMin = Math.min(0, ...visibleValues);
    const yMax = Math.max(...visibleValues);
    const yRange = yMax - yMin || 1;

    const count = x.length;
    const xStep = count > 1 ? PLOT_W / (count - 1) : 0;
    const yBaseline = PAD_T + PLOT_H;

    const paths: { d: string; idx: number }[] = [];
    const areas: { d: string; idx: number }[] = [];
    const seriesPoints: { idx: number; pts: { px: number; py: number; v: number }[] }[] = [];

    series.forEach((s, sIdx) => {
      if (hidden.has(sIdx)) return;
      const seriesValues = s.values.slice(0, x.length);
      if (seriesValues.length === 0) return;
      const points = seriesValues.map((v, i) => {
        const px = PAD_L + i * xStep;
        const py = PAD_T + (1 - (v - yMin) / yRange) * PLOT_H;
        return { px, py, v };
      });
      paths.push({
        idx: sIdx,
        d: points
          .map(({ px, py }, i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`)
          .join(" "),
      });
      if (visibleSeries.length <= 2) {
        const first = points[0]!;
        const last = points[points.length - 1]!;
        const linePart = points
          .map(({ px, py }, i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`)
          .join(" ");
        areas.push({
          idx: sIdx,
          d: `${linePart} L${last.px.toFixed(2)},${yBaseline.toFixed(2)} L${first.px.toFixed(2)},${yBaseline.toFixed(2)} Z`,
        });
      }
      seriesPoints.push({ idx: sIdx, pts: points });
    });

    const tickCount = 3;
    const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / tickCount);
    const stride = Math.max(1, Math.ceil(count / 6));
    const xLabels = x.map((v, i) =>
      i === 0 || i === count - 1 || i % stride === 0 ? String(v) : "",
    );

    return { paths, areas, seriesPoints, yTicks, xLabels, series, x, xStep };
  }, [rawX, rawSeries, hidden]);

  if (data.paths.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-caption text-text-muted">
        {data.series.length > 0 ? t("allHidden") : t("empty")}
      </div>
    );
  }

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || data.x.length === 0) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const { x: vbX } = pt.matrixTransform(ctm.inverse());
    const localX = vbX - PAD_L;
    if (localX < -2 || localX > PLOT_W + 2) {
      setHoverX(null);
      return;
    }
    const idx =
      data.xStep > 0
        ? Math.max(0, Math.min(data.x.length - 1, Math.round(localX / data.xStep)))
        : 0;
    setHoverX(idx);
  }

  // Series rendered, indexed by original position so colors stay stable.
  const visibleAtHover =
    hoverX != null
      ? data.seriesPoints
          .map((sp) => {
            const pt = sp.pts[hoverX];
            if (!pt) return null;
            return { idx: sp.idx, label: data.series[sp.idx]?.label ?? "", px: pt.px, py: pt.py, v: pt.v };
          })
          .filter((v): v is NonNullable<typeof v> => v != null)
      : [];
  const hoverLabel = hoverX != null ? String(data.x[hoverX] ?? hoverX + 1) : "";

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm animate-fade-up">
      {title && <div className="mb-2 text-sm font-medium text-text">{title}</div>}
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="w-full h-auto"
          role="img"
          aria-label={y_label ? `line chart: ${y_label}` : "line chart"}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverX(null)}
        >
          {/* y grid + labels */}
          {data.yTicks.map((t, i) => {
            const py = PAD_T + (1 - i / (data.yTicks.length - 1)) * PLOT_H;
            return (
              <g key={i}>
                <line
                  x1={PAD_L}
                  y1={py}
                  x2={VB_W - PAD_R}
                  y2={py}
                  stroke="var(--color-border)"
                  strokeOpacity="0.6"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <text x={PAD_L - 6} y={py + 3} fontSize="9" textAnchor="end" className="fill-text-muted font-mono">
                  {t.toFixed(Math.abs(t) < 10 ? 1 : 0)}
                </text>
              </g>
            );
          })}
          {/* x labels */}
          {data.xLabels.map((label, i) => {
            if (!label) return null;
            const px = PAD_L + i * data.xStep;
            return (
              <text key={i} x={px} y={VB_H - 8} fontSize="9" textAnchor="middle" className="fill-text-muted font-mono">
                {label}
              </text>
            );
          })}
          {/* areas */}
          {data.areas.map((a, i) => (
            <path
              key={`a-${i}`}
              d={a.d}
              fill={SERIES_COLORS[a.idx % SERIES_COLORS.length]}
              fillOpacity="0.1"
              stroke="none"
            />
          ))}
          {/* series paths */}
          {data.paths.map((p, i) => (
            <path
              key={`l-${i}`}
              d={p.d}
              stroke={SERIES_COLORS[p.idx % SERIES_COLORS.length]}
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* crosshair · vertical line + per-series dot */}
          {hoverX != null && visibleAtHover.length > 0 ? (
            <>
              <line
                x1={visibleAtHover[0]!.px}
                y1={PAD_T}
                x2={visibleAtHover[0]!.px}
                y2={PAD_T + PLOT_H}
                stroke="var(--color-text-subtle)"
                strokeOpacity="0.4"
                strokeWidth="1"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              {visibleAtHover.map((p) => (
                <g key={`hover-${p.idx}`}>
                  <circle cx={p.px} cy={p.py} r="5" fill={SERIES_COLORS[p.idx % SERIES_COLORS.length]} fillOpacity="0.2" />
                  <circle cx={p.px} cy={p.py} r="2.6" fill={SERIES_COLORS[p.idx % SERIES_COLORS.length]} />
                </g>
              ))}
            </>
          ) : null}
        </svg>
        {/* HTML tooltip · positioned over SVG via percent (more reliable than svg getBoundingClientRect) */}
        {hoverX != null && visibleAtHover.length > 0 ? (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface px-2.5 py-1.5 text-caption font-mono shadow-pop"
            style={{
              left: `${(visibleAtHover[0]!.px / VB_W) * 100}%`,
              top: 4,
              transform: "translateX(-50%)",
            }}
          >
            <div className="mb-1 text-text-subtle">{hoverLabel}</div>
            {visibleAtHover.map((p) => (
              <div key={p.idx} className="flex items-center gap-1.5 whitespace-nowrap">
                <span
                  aria-hidden
                  className="inline-block h-[2px] w-3 rounded-sm"
                  style={{ background: SERIES_COLORS[p.idx % SERIES_COLORS.length] }}
                />
                <span className="text-text-muted">{p.label || `s${p.idx + 1}`}</span>
                <span className="ml-auto tabular-nums text-text">{p.v}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {data.series.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption font-mono">
          {data.series.map((s, i) => {
            const isHidden = hidden.has(i);
            return (
              <button
                key={`${i}-${s.label}`}
                type="button"
                onClick={() => toggleSeries(i)}
                title={isHidden ? t("legendHidden") : t("legendVisible")}
                className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors duration-fast hover:bg-surface-2 ${
                  isHidden ? "text-text-subtle" : "text-text-muted"
                }`}
              >
                <span
                  aria-hidden
                  className="inline-block h-[2px] w-3 rounded-sm"
                  style={{
                    background: SERIES_COLORS[i % SERIES_COLORS.length],
                    opacity: isHidden ? 0.35 : 1,
                  }}
                />
                <span className={isHidden ? "line-through" : ""}>{s.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {caption && <div className="mt-2 text-caption font-mono text-text-muted">{caption}</div>}
    </div>
  );
}
