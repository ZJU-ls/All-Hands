"use client";

/**
 * MetricDrawer · slide-over chart for one observatory metric.
 *
 * The observatory page wires every KPI card and every panel row to open
 * this drawer with a specific metric (runs / latency_p95 / tokens_total /
 * cost / …). It fetches /api/observatory/series and renders a single-line
 * SVG chart (no chart library — keeps the bundle small and the visual
 * style on-token).
 *
 * Time window picker (1h / 24h / 7d) lives in the drawer header so the
 * user can drill in without leaving the panel.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import {
  fetchMetricSeries,
  type ObservatoryMetric,
  type TimeSeriesDto,
} from "@/lib/observatory-api";

type WindowKey = "1h" | "24h" | "7d";

const WINDOW_DEFS: Record<WindowKey, { hours: number; bucket: "5m" | "1h" }> = {
  "1h": { hours: 1, bucket: "5m" },
  "24h": { hours: 24, bucket: "1h" },
  "7d": { hours: 24 * 7, bucket: "1h" },
};

export type MetricDrawerProps = {
  open: boolean;
  metric: ObservatoryMetric | null;
  /** Optional override label shown next to the metric title. */
  contextLabel?: string;
  defaultWindow?: WindowKey;
  onClose: () => void;
};

export function MetricDrawer({
  open,
  metric,
  contextLabel,
  defaultWindow = "24h",
  onClose,
}: MetricDrawerProps) {
  const t = useTranslations("pages.observatory.metricDrawer");
  const [windowKey, setWindowKey] = useState<WindowKey>(defaultWindow);
  const [series, setSeries] = useState<TimeSeriesDto | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // ESC closes; only when actually open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset window when drawer opens for a new metric.
  useEffect(() => {
    if (open && metric) setWindowKey(defaultWindow);
  }, [open, metric, defaultWindow]);

  // Load series whenever metric / window changes.
  useEffect(() => {
    if (!open || !metric) return;
    let cancelled = false;
    setState("loading");
    setError(null);
    const def = WINDOW_DEFS[windowKey];
    const until = new Date();
    const since = new Date(until.getTime() - def.hours * 3600 * 1000);
    fetchMetricSeries({
      metric,
      since: since.toISOString(),
      until: until.toISOString(),
      bucket: def.bucket,
    })
      .then((s) => {
        if (cancelled) return;
        setSeries(s);
        setState("ok");
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, metric, windowKey]);

  if (!open || !metric) return null;

  const title = t(`metric.${metric}`);
  const bucketLabel = series?.bucket === "5m" ? t("bucket5m") : t("bucket1h");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex justify-end"
      data-testid="metric-drawer"
    >
      <button
        type="button"
        aria-label={t("close")}
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />
      <aside className="relative flex h-full w-full max-w-[640px] flex-col border-l border-border bg-surface shadow-soft animate-fade-up">
        {/* Header */}
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-muted text-primary">
            <Icon name="activity" size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold tracking-tight text-text">
              {title}
            </h2>
            <p className="mt-0.5 text-[12px] text-text-muted truncate">
              {contextLabel ? `${contextLabel} · ` : ""}
              {bucketLabel}
              {series?.unit ? ` · ${series.unit}` : ""}
            </p>
          </div>
          <RangePills value={windowKey} onChange={setWindowKey} />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text"
          >
            <Icon name="x" size={14} />
          </button>
        </header>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {state === "loading" ? (
            <div className="flex h-[280px] items-center justify-center text-[12px] text-text-muted">
              <Icon name="loader" size={14} className="mr-2 animate-spin" />
              {t("loading")}
            </div>
          ) : state === "error" ? (
            <div className="flex h-[280px] flex-col items-center justify-center gap-3 text-[12px] text-text-muted">
              <Icon name="alert-circle" size={20} className="text-danger" />
              <span>{error ?? t("loadFailed")}</span>
              <button
                type="button"
                onClick={() => setWindowKey((w) => w)}
                className="rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-surface-2"
              >
                {t("retry")}
              </button>
            </div>
          ) : series && series.points.length > 0 ? (
            <>
              <SummaryStrip series={series} />
              <SeriesChart series={series} />
              <PointsTable series={series} />
            </>
          ) : (
            <div className="flex h-[280px] items-center justify-center text-[12px] text-text-muted">
              {t("empty")}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── Range picker ─────────────────────────────────────────────────────────

function RangePills({
  value,
  onChange,
}: {
  value: WindowKey;
  onChange: (k: WindowKey) => void;
}) {
  const t = useTranslations("pages.observatory.metricDrawer");
  const items: { k: WindowKey; label: string }[] = [
    { k: "1h", label: t("rangeLastHour") },
    { k: "24h", label: t("range24h") },
    { k: "7d", label: t("range7d") },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t("rangeAria")}
      className="inline-flex h-8 shrink-0 rounded-md border border-border bg-surface-2 p-0.5"
    >
      {items.map((it) => {
        const active = it.k === value;
        return (
          <button
            type="button"
            key={it.k}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(it.k)}
            className={`px-2.5 text-[11px] rounded transition-colors duration-fast ${
              active
                ? "bg-surface text-text shadow-soft-sm"
                : "text-text-muted hover:text-text"
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Summary strip · max / avg / latest ────────────────────────────────────

function SummaryStrip({ series }: { series: TimeSeriesDto }) {
  const t = useTranslations("pages.observatory.metricDrawer.summaryLabel");
  const stats = useMemo(() => {
    const vals = series.points.map((p) => p.value);
    if (vals.length === 0) return { max: 0, avg: 0, latest: 0 };
    const max = Math.max(...vals);
    const sum = vals.reduce((a, b) => a + b, 0);
    return { max, avg: sum / vals.length, latest: vals[vals.length - 1] ?? 0 };
  }, [series]);
  const fmt = makeFormatter(series);
  return (
    <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-surface-2/30 p-3">
      <Stat label={t("max")} value={fmt(stats.max)} />
      <Stat label={t("avg")} value={fmt(stats.avg)} />
      <Stat label={t("current")} value={fmt(stats.latest)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wide text-text-subtle">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[15px] font-semibold text-text tabular-nums">
        {value}
      </div>
    </div>
  );
}

// ── SVG line chart ────────────────────────────────────────────────────────

function SeriesChart({ series }: { series: TimeSeriesDto }) {
  const t = useTranslations("pages.observatory.metricDrawer");
  const fmt = makeFormatter(series);
  const W = 580;
  const H = 220;
  const PAD = { top: 12, right: 12, bottom: 22, left: 44 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const vals = series.points.map((p) => p.value);
  const max = Math.max(0.0001, ...vals);
  const stepX = vals.length > 1 ? innerW / (vals.length - 1) : innerW;

  const linePath = vals
    .map((v, i) => {
      const x = PAD.left + stepX * i;
      const y = PAD.top + innerH - (v / max) * innerH;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  // Area underneath for visual weight; stops at last point.
  const areaPath =
    vals.length > 1
      ? `${linePath} L ${(PAD.left + stepX * (vals.length - 1)).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} L ${PAD.left.toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`
      : "";

  // 5 horizontal grid ticks.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: PAD.top + innerH * (1 - f),
    label: fmt(max * f),
  }));

  // X-axis labels: first / middle / last bucket.
  const xLabels = (() => {
    const n = series.points.length;
    if (n === 0) return [];
    const fmtT = (iso: string) => {
      try {
        const d = new Date(iso);
        return d.toLocaleString(undefined, {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch {
        return iso;
      }
    };
    const idxs =
      n === 1 ? [0] : n === 2 ? [0, n - 1] : [0, Math.floor(n / 2), n - 1];
    return idxs.map((i) => ({
      x: PAD.left + stepX * i,
      label: fmtT(series.points[i]!.ts),
    }));
  })();

  // Hover state.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (vals.length === 0 || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xpx = ((e.clientX - rect.left) / rect.width) * W - PAD.left;
    const i = Math.round(xpx / Math.max(stepX, 1));
    setHoverIdx(Math.max(0, Math.min(vals.length - 1, i)));
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t(`metric.${series.metric}`)}
        className="w-full h-auto"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* y grid */}
        {yTicks.map((tk, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={tk.y}
              y2={tk.y}
              stroke="var(--color-border)"
              strokeDasharray={i === 4 ? "" : "2 3"}
              strokeWidth={i === 4 ? 1 : 0.5}
            />
            <text
              x={PAD.left - 6}
              y={tk.y + 3}
              textAnchor="end"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
              fill="var(--color-text-subtle)"
            >
              {tk.label}
            </text>
          </g>
        ))}

        {/* Area fill */}
        {areaPath ? (
          <path d={areaPath} fill="var(--color-primary)" fillOpacity="0.08" />
        ) : null}

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Hover marker */}
        {hoverIdx !== null && vals[hoverIdx] !== undefined ? (
          <g>
            <line
              x1={PAD.left + stepX * hoverIdx}
              x2={PAD.left + stepX * hoverIdx}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="var(--color-text-subtle)"
              strokeDasharray="3 3"
              strokeWidth="0.8"
            />
            <circle
              cx={PAD.left + stepX * hoverIdx}
              cy={
                PAD.top +
                innerH -
                ((vals[hoverIdx] ?? 0) / max) * innerH
              }
              r="3.5"
              fill="var(--color-primary)"
              stroke="white"
              strokeWidth="1.5"
            />
          </g>
        ) : null}

        {/* X labels */}
        {xLabels.map((xl, i) => (
          <text
            key={i}
            x={xl.x}
            y={H - 4}
            textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}
            fontSize="10"
            fontFamily="ui-monospace, monospace"
            fill="var(--color-text-subtle)"
          >
            {xl.label}
          </text>
        ))}
      </svg>

      {/* Inline tooltip readout */}
      {hoverIdx !== null && series.points[hoverIdx] ? (
        <div className="mt-2 flex items-center justify-between text-[11px] text-text-muted font-mono">
          <span>{new Date(series.points[hoverIdx]!.ts).toLocaleString()}</span>
          <span className="text-text">
            <span className="font-semibold">
              {fmt(series.points[hoverIdx]!.value)}
            </span>
            <span className="ml-2 text-text-subtle">
              {t("tooltipCount", { n: series.points[hoverIdx]!.count })}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ── Points table (compact bottom view) ────────────────────────────────────

function PointsTable({ series }: { series: TimeSeriesDto }) {
  const fmt = makeFormatter(series);
  const rows = series.points.slice(-12).reverse();
  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <table className="w-full text-[11px] font-mono">
        <thead className="bg-surface-2">
          <tr className="text-text-subtle uppercase tracking-wide">
            <th className="py-1.5 px-3 text-left font-medium">ts</th>
            <th className="py-1.5 px-3 text-right font-medium">value</th>
            <th className="py-1.5 px-3 text-right font-medium">runs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.ts} className="border-t border-border">
              <td className="py-1.5 px-3 text-text-muted">
                {new Date(p.ts).toLocaleString(undefined, {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td className="py-1.5 px-3 text-right text-text tabular-nums">
                {fmt(p.value)}
              </td>
              <td className="py-1.5 px-3 text-right text-text-subtle tabular-nums">
                {p.count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Format helper · respects metric unit ─────────────────────────────────

function makeFormatter(series: TimeSeriesDto): (v: number) => string {
  const unit = series.unit;
  const m = series.metric;
  return (v: number): string => {
    if (m === "failure_rate") return `${(v * 100).toFixed(1)}%`;
    if (unit === "USD") return `$${v.toFixed(4)}`;
    if (unit === "s") {
      if (v < 1) return `${(v * 1000).toFixed(0)}ms`;
      if (v < 60) return `${v.toFixed(2)}s`;
      const min = Math.floor(v / 60);
      const sec = Math.round(v - min * 60);
      return `${min}m ${sec}s`;
    }
    if (unit === "tokens") {
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
      if (v >= 1000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}K`;
      return `${v.toFixed(0)}`;
    }
    return `${Math.round(v)}`;
  };
}
