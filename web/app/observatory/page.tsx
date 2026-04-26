"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState } from "@/components/state";
import { TraceChip } from "@/components/runs/TraceChip";
import { Icon, type IconName } from "@/components/ui/icon";
import { MetricDrawer } from "@/components/observatory/MetricDrawer";
import { LatencyHeatmap } from "@/components/observatory/LatencyHeatmap";
import { CostPanel } from "@/components/observatory/CostPanel";
import {
  fetchMetricSeries,
  fetchObservatorySummary,
  fetchTraces,
  type ObservatoryMetric,
  type ObservatorySummaryDto,
  type TraceSummaryDto,
} from "@/lib/observatory-api";

type LoadState = "idle" | "loading" | "ok" | "error";
type TimeRange = "1h" | "24h" | "7d";

/** Format a fractional delta as "+12.3%" / "−4.1%" or "持平" if near zero. */
function formatDeltaPct(d: number | null | undefined): {
  text: string;
  icon: IconName;
  tone: "success" | "warning" | "danger" | "muted";
} {
  if (d === null || d === undefined) {
    return { text: "—", icon: "trending-up", tone: "muted" };
  }
  const pct = d * 100;
  const abs = Math.abs(pct);
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  const text = abs < 0.5 ? "≈ 0%" : `${sign}${abs.toFixed(1)}%`;
  const icon: IconName = pct >= 0 ? "trending-up" : "trending-down";
  return { text, icon, tone: "muted" };
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatDuration(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  if (s < 1) return `${(s * 1000).toFixed(0)}ms`;
  return `${s.toFixed(2)}s`;
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  return d.toLocaleString(locale);
}

/** Deterministic pseudo-sparkline from a seed (no real time-series in DTO yet). */
function sparkPath(seed: number, points = 24, height = 28, width = 88): string {
  const vals: number[] = [];
  let x = seed;
  for (let i = 0; i < points; i++) {
    x = (x * 9301 + 49297) % 233280;
    vals.push(x / 233280);
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const stepX = width / (points - 1);
  return vals
    .map((v, i) => {
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

interface KpiCardProps {
  label: string;
  value: string;
  delta?: { icon: IconName; text: string; tone: "success" | "warning" | "danger" | "muted" };
  icon: IconName;
  hero?: boolean;
  sparkSeed: number;
  sparkTone?: "primary" | "success" | "warning" | "danger";
  /** Real values to render as a sparkline (overrides seeded fallback). */
  sparkValues?: number[];
  /** When set, the card becomes a button that opens the metric drilldown drawer. */
  onClick?: () => void;
  clickHint?: string;
}

/** Render a sparkline path from real data values (or seeded fallback). */
function realSparkPath(values: number[], height = 28, width = 88): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  return values
    .map((v, i) => {
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function KpiCard({ label, value, delta, icon, hero, sparkSeed, sparkTone = "primary", sparkValues, onClick, clickHint }: KpiCardProps) {
  const deltaToneClass =
    delta?.tone === "success"
      ? "text-success"
      : delta?.tone === "warning"
        ? "text-warning"
        : delta?.tone === "danger"
          ? "text-danger"
          : "text-text-muted";

  const Tag = onClick ? "button" : "div";
  const interactiveProps = onClick
    ? {
        type: "button" as const,
        onClick,
        "aria-label": clickHint ?? label,
      }
    : {};
  const interactiveCls = onClick ? "cursor-pointer text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" : "";

  if (hero) {
    return (
      <Tag
        {...interactiveProps}
        className={`relative overflow-hidden rounded-xl bg-gradient-to-br from-primary via-primary to-primary-hover text-primary-fg p-5 shadow-soft hover:shadow-soft-lg hover:-translate-y-px transition-shadow duration-base ${interactiveCls}`}
      >
        <div
          aria-hidden
          className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/15 blur-2xl"
        />
        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-mono opacity-80">
            <Icon name={icon} size={12} />
            {label}
          </div>
          <div className="h-6 w-6 rounded-md bg-white/15 grid place-items-center">
            <Icon name="sparkles" size={12} />
          </div>
        </div>
        <div className="relative mt-3 text-[32px] font-semibold tabular-nums leading-none tracking-tight">
          {value}
        </div>
        <div className="relative mt-3 flex items-end justify-between gap-3">
          {delta ? (
            <div className="inline-flex items-center gap-1 text-[11px] font-mono opacity-95">
              <Icon name={delta.icon} size={12} />
              {delta.text}
            </div>
          ) : (
            <span />
          )}
          <svg
            aria-hidden
            viewBox="0 0 88 28"
            className="w-[88px] h-7 text-white/80 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d={
                sparkValues && sparkValues.length > 1
                  ? realSparkPath(sparkValues)
                  : sparkPath(sparkSeed)
              }
            />
          </svg>
        </div>
      </Tag>
    );
  }

  const sparkColor =
    sparkTone === "success"
      ? "text-success"
      : sparkTone === "warning"
        ? "text-warning"
        : sparkTone === "danger"
          ? "text-danger"
          : "text-primary";

  return (
    <Tag
      {...interactiveProps}
      className={`relative overflow-hidden rounded-xl bg-surface border border-border p-5 shadow-soft-sm hover:shadow-soft hover:-translate-y-px hover:border-border-strong transition-shadow duration-base ${interactiveCls}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-mono text-text-subtle">
          <Icon name={icon} size={12} />
          {label}
        </div>
        <div className="h-6 w-6 rounded-md bg-primary/10 text-primary grid place-items-center">
          <Icon name={icon} size={12} />
        </div>
      </div>
      <div className="mt-3 text-[28px] font-semibold tabular-nums leading-none tracking-tight text-text">
        {value}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        {delta ? (
          <div className={`inline-flex items-center gap-1 text-[11px] font-mono ${deltaToneClass}`}>
            <Icon name={delta.icon} size={12} />
            {delta.text}
          </div>
        ) : (
          <span />
        )}
        <svg
          aria-hidden
          viewBox="0 0 88 28"
          className={`w-[88px] h-7 shrink-0 ${sparkColor}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d={
              sparkValues && sparkValues.length > 1
                ? realSparkPath(sparkValues)
                : sparkPath(sparkSeed)
            }
          />
        </svg>
      </div>
    </Tag>
  );
}

function HealthPanel({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: IconName;
  rows: Array<{
    label: string;
    value: string;
    tone?: "success" | "warning" | "danger" | "muted";
    onClick?: () => void;
  }>;
}) {
  const t = useTranslations("pages.observatory.panels");
  return (
    <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 h-11 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-primary/10 text-primary grid place-items-center">
            <Icon name={icon} size={13} />
          </div>
          <span className="text-[13px] font-semibold text-text">{title}</span>
        </div>
        <button
          type="button"
          className="h-6 w-6 rounded-md text-text-subtle hover:text-text hover:bg-surface-2 grid place-items-center transition-colors duration-fast"
          aria-label={t("moreLabel", { title })}
        >
          <Icon name="more-horizontal" size={14} />
        </button>
      </div>
      <ul className="divide-y divide-border">
        {rows.length === 0 ? (
          <li className="px-5 py-5 text-[12px] text-text-muted">{t("noData")}</li>
        ) : (
          rows.map((row, idx) => {
            const toneClass =
              row.tone === "success"
                ? "text-success"
                : row.tone === "warning"
                  ? "text-warning"
                  : row.tone === "danger"
                    ? "text-danger"
                    : "text-text";
            const Inner = (
              <>
                <span className="text-[12px] text-text truncate mr-3">{row.label}</span>
                <span className={`text-[12px] font-mono tabular-nums ${toneClass}`}>
                  {row.value}
                </span>
              </>
            );
            return (
              <li key={`${row.label}-${idx}`}>
                {row.onClick ? (
                  <button
                    type="button"
                    onClick={row.onClick}
                    className="flex w-full items-center justify-between px-5 h-10 hover:bg-surface-2 transition-colors duration-fast text-left focus-visible:outline-none focus-visible:bg-surface-2"
                  >
                    {Inner}
                    <Icon
                      name="chevron-right"
                      size={12}
                      className="ml-2 text-text-subtle"
                    />
                  </button>
                ) : (
                  <div className="flex items-center justify-between px-5 h-10 hover:bg-surface-2 transition-colors duration-fast">
                    {Inner}
                  </div>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

// ── Tools panel · top tool invocations + failure rate ─────────────────────

function ToolsPanel({
  rows,
}: {
  rows: import("@/lib/observatory-api").ObservatoryToolBreakdownDto[];
}) {
  const t = useTranslations("pages.observatory.panels");
  const totalInv = rows.reduce((acc, r) => acc + r.invocations, 0);
  const top = rows.slice(0, 8);
  return (
    <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 h-11 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-primary/10 text-primary grid place-items-center">
            <Icon name="plug" size={13} />
          </div>
          <span className="text-[13px] font-semibold text-text">
            {t("byTool")}
          </span>
        </div>
        <span className="text-[11px] font-mono text-text-subtle">
          {t("byToolHint", { n: rows.length, invocations: totalInv })}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-6 text-[12px] text-text-muted">
          {t("byToolEmpty")}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {top.map((r) => {
            const failTone =
              r.failure_rate >= 0.2
                ? "text-danger"
                : r.failure_rate >= 0.05
                  ? "text-warning"
                  : "text-text-muted";
            return (
              <li
                key={r.tool_id}
                className="flex items-center gap-3 px-5 h-11 hover:bg-surface-2 transition-colors duration-fast"
              >
                <code className="font-mono text-[11.5px] text-text truncate flex-1">
                  {r.tool_id}
                </code>
                <span className="font-mono text-[11px] text-text-muted tabular-nums shrink-0">
                  {r.invocations}
                </span>
                <span
                  className={`font-mono text-[11px] tabular-nums shrink-0 w-12 text-right ${failTone}`}
                >
                  {(r.failure_rate * 100).toFixed(1)}%
                </span>
                <span className="font-mono text-[11px] text-text-subtle tabular-nums shrink-0 w-14 text-right">
                  {r.avg_duration_s > 0
                    ? r.avg_duration_s < 1
                      ? `${(r.avg_duration_s * 1000).toFixed(0)}ms`
                      : `${r.avg_duration_s.toFixed(2)}s`
                    : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Errors panel · top failure kinds ──────────────────────────────────────

function ErrorsPanel({
  rows,
}: {
  rows: import("@/lib/observatory-api").ObservatoryErrorBreakdownDto[];
}) {
  const t = useTranslations("pages.observatory.panels");
  const totalCount = rows.reduce((acc, r) => acc + r.count, 0);
  return (
    <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 h-11 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-danger-soft text-danger grid place-items-center">
            <Icon name="alert-triangle" size={13} />
          </div>
          <span className="text-[13px] font-semibold text-text">
            {t("topErrors")}
          </span>
        </div>
        <span className="text-[11px] font-mono text-text-subtle">
          {t("topErrorsHint", { n: rows.length, count: totalCount })}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-6 text-[12px] text-text-muted">
          {t("topErrorsEmpty")}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.slice(0, 6).map((r) => (
            <li key={r.error_kind} className="px-5 py-2.5">
              <div className="flex items-center gap-2">
                <code className="font-mono text-[11.5px] text-danger">
                  {r.error_kind}
                </code>
                <span className="ml-auto font-mono text-[11px] text-text-muted tabular-nums">
                  × {r.count}
                </span>
              </div>
              {r.last_message ? (
                <div className="mt-1 text-[11.5px] text-text-muted line-clamp-2">
                  {r.last_message}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-xl bg-surface border border-border p-5 shadow-soft-sm">
      <div className="flex items-center justify-between">
        <div className="h-3 w-20 rounded bg-surface-3 animate-pulse" />
        <div className="h-6 w-6 rounded-md bg-surface-3 animate-pulse" />
      </div>
      <div className="mt-4 h-7 w-24 rounded bg-surface-3 animate-pulse" />
      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="h-3 w-14 rounded bg-surface-3 animate-pulse" />
        <div className="h-6 w-[88px] rounded bg-surface-3 animate-pulse" />
      </div>
    </div>
  );
}

function TimeRangePills({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
}) {
  const t = useTranslations("pages.observatory.range");
  const opts: Array<{ key: TimeRange; label: string }> = [
    { key: "1h", label: t("lastHour") },
    { key: "24h", label: t("h24") },
    { key: "7d", label: t("d7") },
  ];
  return (
    <div className="inline-flex p-1 rounded-lg bg-surface-2 border border-border">
      {opts.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={
              active
                ? "h-7 px-3 rounded-md bg-surface text-primary text-[12px] font-semibold shadow-soft-sm transition-colors duration-fast"
                : "h-7 px-3 rounded-md text-text-muted hover:text-text text-[12px] font-medium transition-colors duration-fast"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function ObservatoryPage() {
  const t = useTranslations("pages.observatory");
  const locale = useLocale();
  const [summary, setSummary] = useState<ObservatorySummaryDto | null>(null);
  const [traces, setTraces] = useState<TraceSummaryDto[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRange>("24h");
  const [drawerMetric, setDrawerMetric] = useState<ObservatoryMetric | null>(null);
  const [drawerLabel, setDrawerLabel] = useState<string | undefined>(undefined);
  const [traceSearch, setTraceSearch] = useState("");
  const openDrawer = (metric: ObservatoryMetric, label?: string) => {
    setDrawerMetric(metric);
    setDrawerLabel(label);
  };
  const filteredTraces = useMemo(() => {
    const q = traceSearch.trim().toLowerCase();
    if (!q) return traces;
    return traces.filter((tr) => {
      return (
        tr.trace_id.toLowerCase().includes(q) ||
        (tr.employee_name?.toLowerCase().includes(q) ?? false) ||
        (tr.employee_id?.toLowerCase().includes(q) ?? false) ||
        (tr.model_ref?.toLowerCase().includes(q) ?? false) ||
        tr.status.toLowerCase().includes(q)
      );
    });
  }, [traces, traceSearch]);
  // Real sparkline values for the 4 KPI cards · 24h × 1h buckets.
  const [sparks, setSparks] = useState<{
    runs: number[];
    failure_rate: number[];
    latency_p50: number[];
    tokens_total: number[];
  } | null>(null);

  async function load() {
    setState("loading");
    setError(null);
    try {
      const hours = range === "1h" ? 1 : range === "7d" ? 168 : 24;
      const [s, t, runs, fr, lat, tok] = await Promise.all([
        fetchObservatorySummary(hours),
        fetchTraces({ limit: 50 }),
        fetchMetricSeries({ metric: "runs", bucket: "1h" }),
        fetchMetricSeries({ metric: "failure_rate", bucket: "1h" }),
        fetchMetricSeries({ metric: "latency_p50", bucket: "1h" }),
        fetchMetricSeries({ metric: "tokens_total", bucket: "1h" }),
      ]);
      setSummary(s);
      setTraces(t.traces);
      setSparks({
        runs: runs.points.map((p) => p.value),
        failure_rate: fr.points.map((p) => p.value),
        latency_p50: lat.points.map((p) => p.value),
        tokens_total: tok.points.map((p) => p.value),
      });
      setState("ok");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const incidents = useMemo(
    () => traces.filter((t) => t.status === "failed").slice(0, 5),
    [traces],
  );

  // Self-instrumented · status pill is always success now that Langfuse is gone.
  const toneDot = "bg-success";

  return (
    <AppShell title={t("title")}>
      <div className="h-full overflow-y-auto bg-bg">
        <div className="mx-auto max-w-[1400px] px-6 md:px-8 py-8 space-y-8">
          {/* HEADER */}
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] font-mono text-primary">
                <span className="relative inline-block w-1.5 h-1.5">
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60"
                  />
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-primary"
                  />
                </span>
                {t("eyebrow")}
              </div>
              <h1 className="mt-2 text-[28px] md:text-[32px] font-semibold tracking-tight text-text">
                {t("heading")}
              </h1>
              <p className="mt-1 text-[13px] text-text-muted">
                {t("subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <TimeRangePills value={range} onChange={setRange} />
              <button
                type="button"
                onClick={load}
                disabled={state === "loading"}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-surface border border-border hover:border-border-strong text-[12px] font-medium text-text transition-colors duration-fast disabled:opacity-50"
              >
                <Icon
                  name="refresh"
                  size={13}
                  className={state === "loading" ? "animate-spin" : ""}
                />
                {state === "loading" ? t("refreshing") : t("refresh")}
              </button>
            </div>
          </header>

          {/* ANOMALY CALLOUTS · explainable rules · only when present */}
          {summary && summary.anomalies.length > 0 ? (
            <section
              role="alert"
              className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3"
            >
              <div className="flex items-start gap-3">
                <Icon name="alert-triangle" size={16} className="mt-0.5 text-warning" />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="text-[12.5px] font-semibold text-text">
                    {t("anomalies.title", { n: summary.anomalies.length })}
                  </div>
                  <ul className="space-y-1">
                    {summary.anomalies.map((line, i) => (
                      <li
                        key={i}
                        className="font-mono text-[11.5px] text-text-muted"
                      >
                        · {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}

          {/* ERROR BANNER */}
          {state === "error" && !summary ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-border bg-danger-soft px-4 py-3"
            >
              <div className="mt-0.5 text-danger">
                <Icon name="alert-circle" size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-text">{t("loadFailed.title")}</div>
                <div className="mt-0.5 text-[12px] text-text-muted">
                  {error ?? t("loadFailed.fallback")}
                </div>
              </div>
              <button
                type="button"
                onClick={load}
                className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-surface border border-border hover:border-border-strong text-[12px] font-medium text-text transition-colors duration-fast"
              >
                <Icon name="refresh" size={12} />
                {t("loadFailed.action")}
              </button>
            </div>
          ) : null}

          {/* KPI STRIP */}
          <section>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {summary ? (
                <>
                  {(() => {
                    // Uptime card uses an inverted "failure_rate_delta_pct" —
                    // a fall in failure rate is an *uptime improvement* so we
                    // flip the sign before formatting.
                    const uptimeDelta = formatDeltaPct(
                      summary.failure_rate_delta_pct === null
                        ? null
                        : -summary.failure_rate_delta_pct,
                    );
                    return (
                      <KpiCard
                        hero
                        icon="activity"
                        label={t("kpi.uptime")}
                        value={formatPct(1 - summary.failure_rate_24h)}
                        delta={{
                          icon: uptimeDelta.icon,
                          text: `${uptimeDelta.text} ${t("kpi.vsYesterday")}`,
                          tone: uptimeDelta.tone,
                        }}
                        sparkSeed={11}
                        sparkValues={
                          sparks
                            ? sparks.failure_rate.map((v) => 1 - v)
                            : undefined
                        }
                        onClick={() => openDrawer("failure_rate", t("kpi.uptime"))}
                        clickHint={t("kpi.clickHint")}
                      />
                    );
                  })()}
                  {(() => {
                    const latDelta = formatDeltaPct(summary.latency_p50_delta_pct);
                    // For latency, going down is good; flip tone semantics.
                    const tone: "success" | "warning" | "danger" | "muted" =
                      summary.latency_p50_delta_pct === null
                        ? "muted"
                        : summary.latency_p50_delta_pct < -0.05
                          ? "success"
                          : summary.latency_p50_delta_pct > 0.20
                            ? "warning"
                            : "muted";
                    return (
                      <KpiCard
                        icon="zap"
                        label={t("kpi.latency")}
                        value={formatDuration(summary.latency_p50_s)}
                        delta={{
                          icon: latDelta.icon,
                          text: `${latDelta.text} ${t("kpi.vsYesterday")}`,
                          tone,
                        }}
                        sparkSeed={23}
                        sparkTone="primary"
                        sparkValues={sparks?.latency_p50}
                        onClick={() => openDrawer("latency_p50", t("kpi.latency"))}
                        clickHint={t("kpi.clickHint")}
                      />
                    );
                  })()}
                  {(() => {
                    const fd = formatDeltaPct(summary.failure_rate_delta_pct);
                    const stableLabel =
                      summary.failure_rate_24h > 0.05
                        ? t("kpi.failureWarn")
                        : t("kpi.failureStable");
                    const composedDelta = `${fd.text} · ${stableLabel}`;
                    return (
                      <KpiCard
                        icon="alert-circle"
                        label={t("kpi.failure")}
                        value={formatPct(summary.failure_rate_24h)}
                        delta={{
                          icon: fd.icon,
                          text: composedDelta,
                          tone:
                            summary.failure_rate_24h > 0.05
                              ? "danger"
                              : summary.failure_rate_24h > 0.02
                                ? "warning"
                                : "success",
                        }}
                        sparkSeed={37}
                        sparkValues={sparks?.failure_rate}
                        sparkTone={
                          summary.failure_rate_24h > 0.05
                            ? "danger"
                            : summary.failure_rate_24h > 0.02
                              ? "warning"
                              : "success"
                        }
                        onClick={() =>
                          openDrawer("failure_rate", t("kpi.failure"))
                        }
                        clickHint={t("kpi.clickHint")}
                      />
                    );
                  })()}
                  <KpiCard
                    icon="database"
                    label={t("kpi.totalTokens")}
                    value={
                      summary.total_tokens_total > 0
                        ? formatTokens(summary.total_tokens_total)
                        : "—"
                    }
                    delta={{
                      icon: "trending-up",
                      text:
                        summary.total_tokens_total > 0
                          ? t("kpi.totalTokensDelta", {
                              input: formatTokens(summary.input_tokens_total),
                              output: formatTokens(summary.output_tokens_total),
                              avg: summary.avg_tokens_per_run.toLocaleString(),
                            })
                          : t("kpi.tokensDelta", {
                              count: summary.traces_total.toLocaleString(),
                            }),
                      tone: "muted",
                    }}
                    sparkSeed={53}
                    sparkTone="primary"
                    sparkValues={sparks?.tokens_total}
                    onClick={() => openDrawer("tokens_total", t("kpi.totalTokens"))}
                    clickHint={t("kpi.clickHint")}
                  />
                  <KpiCard
                    icon="zap"
                    label={t("kpi.llmCalls")}
                    value={
                      summary.llm_calls_total > 0
                        ? summary.llm_calls_total.toLocaleString()
                        : "—"
                    }
                    delta={{
                      icon: "trending-up",
                      text:
                        summary.traces_total > 0
                          ? t("kpi.llmCallsDelta", {
                              runs: summary.traces_total.toLocaleString(),
                              avg:
                                summary.traces_total > 0
                                  ? (
                                      summary.llm_calls_total /
                                      summary.traces_total
                                    ).toFixed(1)
                                  : "0",
                            })
                          : t("kpi.llmCallsEmpty"),
                      tone: "muted",
                    }}
                    sparkSeed={67}
                    sparkTone="primary"
                    sparkValues={sparks?.runs}
                    onClick={() => openDrawer("llm_calls", t("kpi.llmCalls"))}
                    clickHint={t("kpi.clickHint")}
                  />
                </>
              ) : state === "loading" ? (
                <>
                  <KpiSkeleton />
                  <KpiSkeleton />
                  <KpiSkeleton />
                  <KpiSkeleton />
                  <KpiSkeleton />
                </>
              ) : null}
            </div>
          </section>

          {summary ? (
            <>
              {/* SECONDARY GRID */}
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <HealthPanel
                  title={t("panels.telemetry")}
                  icon="shield-check"
                  rows={[
                    {
                      label: t("panels.rows.observability"),
                      value: t("panels.values.selfInstrumented"),
                      tone: "success",
                    },
                    {
                      label: t("panels.rows.latencyP50"),
                      value: formatDuration(summary.latency_p50_s),
                      tone: "muted",
                      onClick: () =>
                        openDrawer("latency_p50", t("panels.rows.latencyP50")),
                    },
                    {
                      label: t("panels.rows.latencyP95"),
                      value: formatDuration(summary.latency_p95_s),
                      tone: "muted",
                      onClick: () =>
                        openDrawer("latency_p95", t("panels.rows.latencyP95")),
                    },
                    {
                      label: t("panels.rows.latencyP99"),
                      value: formatDuration(summary.latency_p99_s),
                      tone: "muted",
                      onClick: () =>
                        openDrawer("latency_p99", t("panels.rows.latencyP99")),
                    },
                    {
                      label: t("panels.rows.estimatedCost"),
                      value:
                        summary.estimated_cost_usd > 0
                          ? `$${summary.estimated_cost_usd.toFixed(4)}`
                          : "—",
                      tone: "muted",
                      onClick: () =>
                        openDrawer("cost", t("panels.rows.estimatedCost")),
                    },
                    {
                      label: t("panels.rows.totalTraces"),
                      value: summary.traces_total.toLocaleString(),
                      onClick: () =>
                        openDrawer("runs", t("panels.rows.totalTraces")),
                    },
                  ]}
                />
                <HealthPanel
                  title={t("panels.topEmployees")}
                  icon="users"
                  rows={
                    summary.by_employee.length > 0
                      ? summary.by_employee.slice(0, 6).map((row) => ({
                          label: row.employee_name,
                          value:
                            row.total_tokens > 0
                              ? `${row.runs_count} · ${formatTokens(row.total_tokens)} tok`
                              : t("panels.values.runs", {
                                  count: row.runs_count.toLocaleString(),
                                }),
                        }))
                      : []
                  }
                />
              </section>

              {summary.by_model.length > 0 ? (
                <section>
                  <div className="flex items-baseline justify-between mb-3">
                    <h2 className="text-[18px] font-semibold tracking-tight text-text flex items-center gap-2">
                      <Icon name="brain" size={16} className="text-primary" />
                      {t("panels.byModel")}
                    </h2>
                    <span className="text-[11px] font-mono text-text-subtle">
                      {summary.by_model.length} models · {summary.llm_calls_total} calls
                    </span>
                  </div>
                  <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
                    <table className="w-full border-collapse text-[12px]">
                      <thead>
                        <tr className="bg-surface-2 text-left text-text-subtle border-b border-border">
                          <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium">
                            model
                          </th>
                          <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums text-right">
                            runs
                          </th>
                          <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums text-right">
                            in
                          </th>
                          <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums text-right">
                            out
                          </th>
                          <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums text-right">
                            total
                          </th>
                          <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums text-right">
                            {t("panels.modelTable.cost")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.by_model.map((row) => (
                          <tr
                            key={row.model_ref}
                            className="border-b border-border last:border-b-0 hover:bg-surface-2/40"
                          >
                            <td className="py-2 px-4 font-mono text-[11px] text-text">
                              {row.model_ref}
                            </td>
                            <td className="py-2 px-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                              {row.runs_count.toLocaleString()}
                            </td>
                            <td className="py-2 px-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                              {formatTokens(row.input_tokens)}
                            </td>
                            <td className="py-2 px-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                              {formatTokens(row.output_tokens)}
                            </td>
                            <td className="py-2 px-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                              {formatTokens(row.total_tokens)}
                            </td>
                            <td className="py-2 px-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                              {row.estimated_cost_usd > 0
                                ? `$${row.estimated_cost_usd.toFixed(4)}`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {/* TOOLS + ERRORS · two-column row */}
              {summary.by_tool.length > 0 || summary.top_errors.length > 0 ? (
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ToolsPanel rows={summary.by_tool} />
                  <ErrorsPanel rows={summary.top_errors} />
                </section>
              ) : null}

              {/* COST PANEL · Helicone-style total + projections + drivers */}
              <section>
                <CostPanel
                  totalUsd={summary.estimated_cost_usd}
                  byEmployee={summary.by_employee}
                  byModel={summary.by_model}
                  onClickDrillDown={() =>
                    openDrawer("cost", t("panels.rows.estimatedCost"))
                  }
                />
              </section>

              {/* LATENCY HEATMAP · Honeycomb-style 24h x latency-bucket grid */}
              <section>
                <LatencyHeatmap
                  cells={summary.latency_heatmap}
                  buckets={summary.latency_heatmap_buckets_s}
                />
              </section>

              {/* INCIDENTS */}
              {incidents.length > 0 ? (
                <section>
                  <div className="flex items-baseline justify-between mb-3">
                    <h2 className="text-[18px] font-semibold tracking-tight text-text flex items-center gap-2">
                      <Icon name="alert-triangle" size={16} className="text-danger" />
                      {t("incidents.title")}
                    </h2>
                    <span className="text-[11px] font-mono text-text-subtle">
                      {t("incidents.count", { count: incidents.length })}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {incidents.map((row) => (
                      <div
                        key={row.trace_id}
                        className="relative overflow-hidden rounded-lg bg-surface border border-border shadow-soft-sm hover:shadow-soft transition-shadow duration-base pl-4 pr-4 py-3"
                      >
                        <div
                          aria-hidden
                          className="absolute left-0 top-0 bottom-0 w-[3px] bg-danger"
                        />
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-mono bg-danger-soft text-danger">
                              <Icon name="alert-circle" size={11} />
                              {t("traces.status.failed")}
                            </span>
                            <TraceChip runId={row.trace_id} label={row.trace_id} />
                            <span className="text-[12px] text-text truncate">
                              {row.employee_name ?? row.employee_id ?? "—"}
                            </span>
                          </div>
                          <div className="shrink-0 flex items-center gap-4 text-[11px] font-mono text-text-muted tabular-nums">
                            <span className="inline-flex items-center gap-1">
                              <Icon name="clock" size={11} />
                              {formatDuration(row.duration_s)}
                            </span>
                            <span>{row.tokens.total.toLocaleString()} {t("incidents.tokensSuffix")}</span>
                            <span className="hidden md:inline">{formatDate(row.started_at, locale)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* TRACES */}
              <section>
                <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                  <h2 className="text-[18px] font-semibold tracking-tight text-text flex items-center gap-2">
                    <Icon name="activity" size={16} className="text-primary" />
                    {t("traces.title")}
                  </h2>
                  <div className="flex items-center gap-2 ml-auto">
                    <div className="relative">
                      <Icon
                        name="search"
                        size={13}
                        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle"
                      />
                      <input
                        value={traceSearch}
                        onChange={(e) => setTraceSearch(e.target.value)}
                        placeholder={t("traces.searchPlaceholder")}
                        aria-label={t("traces.searchAria")}
                        className="h-8 w-[260px] rounded-md border border-border bg-surface pl-8 pr-3 text-[12px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
                      />
                    </div>
                    <div className="inline-flex items-center gap-2 text-[11px] font-mono text-text-subtle">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${toneDot}`}
                      />
                      {t("traces.selfInstrumentedNote")}
                    </div>
                  </div>
                </div>

                {filteredTraces.length === 0 ? (
                  <EmptyState
                    title={
                      traceSearch
                        ? t("traces.searchEmpty.title")
                        : t("traces.empty.title")
                    }
                    description={
                      traceSearch
                        ? t("traces.searchEmpty.description")
                        : t("traces.empty.description")
                    }
                  />
                ) : (
                  <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
                    <table className="w-full border-collapse text-[12px]">
                      <thead>
                        <tr className="bg-surface-2 text-left text-text-subtle border-b border-border">
                          <th className="py-2.5 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium">
                            {t("traces.headers.trace")}
                          </th>
                          <th className="py-2.5 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium">
                            {t("traces.headers.employee")}
                          </th>
                          <th className="py-2.5 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium">
                            {t("traces.headers.status")}
                          </th>
                          <th className="py-2.5 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums text-right">
                            {t("traces.headers.duration")}
                          </th>
                          <th className="py-2.5 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums text-right">
                            {t("traces.headers.tokens")}
                          </th>
                          <th className="py-2.5 px-4 font-mono text-[10px] uppercase tracking-[0.12em] font-medium">
                            {t("traces.headers.started")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTraces.map((row) => (
                          <tr
                            key={row.trace_id}
                            className="border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors duration-fast"
                          >
                            <td className="py-2.5 px-4 font-mono text-[11px] text-text-muted truncate max-w-[220px]">
                              <TraceChip runId={row.trace_id} label={row.trace_id} />
                            </td>
                            <td className="py-2.5 px-4 text-text">
                              {row.employee_name ?? row.employee_id ?? "—"}
                            </td>
                            <td className="py-2.5 px-4">
                              {row.status === "failed" ? (
                                <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-mono bg-danger-soft text-danger">
                                  <Icon name="alert-circle" size={11} />
                                  {t("traces.status.failed")}
                                </span>
                              ) : row.status === "running" ? (
                                <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-mono bg-warning-soft text-warning">
                                  <Icon name="loader" size={11} className="animate-spin-slow" />
                                  {t("traces.status.running")}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-mono bg-success-soft text-success">
                                  <Icon name="check-circle-2" size={11} />
                                  {t("traces.status.ok")}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                              {formatDuration(row.duration_s)}
                            </td>
                            <td
                              className="py-2.5 px-4 text-right font-mono text-[11px] text-text-muted tabular-nums"
                              title={
                                row.tokens.total > 0
                                  ? `in ${row.tokens.prompt.toLocaleString()} · out ${row.tokens.completion.toLocaleString()} · total ${row.tokens.total.toLocaleString()}`
                                  : undefined
                              }
                            >
                              {row.tokens.total > 0 ? row.tokens.total.toLocaleString() : "—"}
                            </td>
                            <td className="py-2.5 px-4 text-text-muted">
                              {formatDate(row.started_at, locale)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
      <MetricDrawer
        open={drawerMetric !== null}
        metric={drawerMetric}
        contextLabel={drawerLabel}
        defaultWindow="24h"
        onClose={() => setDrawerMetric(null)}
      />
    </AppShell>
  );
}
