"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState } from "@/components/state";
import { TraceChip } from "@/components/runs/TraceChip";
import { Icon, type IconName } from "@/components/ui/icon";
import {
  fetchObservatorySummary,
  fetchTraces,
  retryBootstrap,
  type BootstrapStatus,
  type ObservatorySummaryDto,
  type TraceSummaryDto,
} from "@/lib/observatory-api";

type LoadState = "idle" | "loading" | "ok" | "error";
type TimeRange = "1h" | "24h" | "7d";

function statusLabel(s: BootstrapStatus): string {
  switch (s) {
    case "ok":
      return "ok";
    case "external":
      return "external";
    case "pending":
      return "pending";
    case "failed":
      return "failed";
  }
}

function bootstrapTone(s: BootstrapStatus): "success" | "warning" | "danger" {
  if (s === "ok" || s === "external") return "success";
  if (s === "pending") return "warning";
  return "danger";
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatDuration(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  if (s < 1) return `${(s * 1000).toFixed(0)}ms`;
  return `${s.toFixed(2)}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
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
}

function KpiCard({ label, value, delta, icon, hero, sparkSeed, sparkTone = "primary" }: KpiCardProps) {
  const deltaToneClass =
    delta?.tone === "success"
      ? "text-success"
      : delta?.tone === "warning"
        ? "text-warning"
        : delta?.tone === "danger"
          ? "text-danger"
          : "text-text-muted";

  if (hero) {
    return (
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary via-primary to-primary-hover text-primary-fg p-5 shadow-soft hover:shadow-soft-lg hover:-translate-y-px transition-shadow duration-base">
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
            <path d={sparkPath(sparkSeed)} />
          </svg>
        </div>
      </div>
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
    <div className="relative overflow-hidden rounded-xl bg-surface border border-border p-5 shadow-soft-sm hover:shadow-soft hover:-translate-y-px hover:border-border-strong transition-shadow duration-base">
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
          <path d={sparkPath(sparkSeed)} />
        </svg>
      </div>
    </div>
  );
}

function HealthPanel({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: IconName;
  rows: Array<{ label: string; value: string; tone?: "success" | "warning" | "danger" | "muted" }>;
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
            return (
              <li
                key={`${row.label}-${idx}`}
                className="flex items-center justify-between px-5 h-10 hover:bg-surface-2 transition-colors duration-fast"
              >
                <span className="text-[12px] text-text truncate mr-3">{row.label}</span>
                <span className={`text-[12px] font-mono tabular-nums ${toneClass}`}>
                  {row.value}
                </span>
              </li>
            );
          })
        )}
      </ul>
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
  const [summary, setSummary] = useState<ObservatorySummaryDto | null>(null);
  const [traces, setTraces] = useState<TraceSummaryDto[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, startRetry] = useTransition();
  const [range, setRange] = useState<TimeRange>("24h");

  async function load() {
    setState("loading");
    setError(null);
    try {
      const [s, t] = await Promise.all([
        fetchObservatorySummary(),
        fetchTraces({ limit: 50 }),
      ]);
      setSummary(s);
      setTraces(t.traces);
      setState("ok");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function onRetry() {
    startRetry(async () => {
      try {
        await retryBootstrap();
        await load();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  const incidents = useMemo(
    () => traces.filter((t) => t.status === "failed").slice(0, 5),
    [traces],
  );

  const tone = summary ? bootstrapTone(summary.bootstrap_status) : "warning";
  const toneDot =
    tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-danger";
  const toneText =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-danger";
  const toneSoft =
    tone === "success"
      ? "bg-success-soft"
      : tone === "warning"
        ? "bg-warning-soft"
        : "bg-danger-soft";

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

          {/* BOOTSTRAP BANNER */}
          {summary && !summary.observability_enabled ? (
            <div
              role="alert"
              className={`flex items-start gap-3 rounded-lg border border-border ${toneSoft} px-4 py-3`}
            >
              <div className={`mt-0.5 ${toneText}`}>
                <Icon name="alert-triangle" size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-text">
                  {t("bootstrap.headlinePrefix")} {statusLabel(summary.bootstrap_status)} {t("bootstrap.headlineSuffix")}
                </div>
                <div className="mt-0.5 text-[12px] text-text-muted">
                  {t("bootstrap.body")}
                  {summary.bootstrap_error ? (
                    <>
                      {" "}
                      <span className="text-text-subtle font-mono">
                        {t("bootstrap.lastPrefix")} {summary.bootstrap_error}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={onRetry}
                disabled={isRetrying}
                className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-surface border border-border hover:border-border-strong text-[12px] font-medium text-text transition-colors duration-fast disabled:opacity-50"
              >
                <Icon
                  name="refresh"
                  size={12}
                  className={isRetrying ? "animate-spin" : ""}
                />
                {isRetrying ? t("bootstrap.retrying") : t("bootstrap.retry")}
              </button>
            </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {summary ? (
                <>
                  <KpiCard
                    hero
                    icon="activity"
                    label={t("kpi.uptime")}
                    value={formatPct(1 - summary.failure_rate_24h)}
                    delta={{
                      icon: "trending-up",
                      text: t("kpi.uptimeDelta"),
                      tone: "muted",
                    }}
                    sparkSeed={11}
                  />
                  <KpiCard
                    icon="zap"
                    label={t("kpi.latency")}
                    value={formatDuration(summary.latency_p50_s)}
                    delta={{
                      icon: "trending-down",
                      text: t("kpi.latencyDelta"),
                      tone: "success",
                    }}
                    sparkSeed={23}
                    sparkTone="primary"
                  />
                  <KpiCard
                    icon="alert-circle"
                    label={t("kpi.failure")}
                    value={formatPct(summary.failure_rate_24h)}
                    delta={{
                      icon:
                        summary.failure_rate_24h > 0.02
                          ? "trending-up"
                          : "trending-down",
                      text: summary.failure_rate_24h > 0.02 ? t("kpi.failureWarn") : t("kpi.failureStable"),
                      tone:
                        summary.failure_rate_24h > 0.05
                          ? "danger"
                          : summary.failure_rate_24h > 0.02
                            ? "warning"
                            : "success",
                    }}
                    sparkSeed={37}
                    sparkTone={
                      summary.failure_rate_24h > 0.05
                        ? "danger"
                        : summary.failure_rate_24h > 0.02
                          ? "warning"
                          : "success"
                    }
                  />
                  <KpiCard
                    icon="database"
                    label={t("kpi.tokens")}
                    value={summary.avg_tokens_per_run.toLocaleString()}
                    delta={{
                      icon: "trending-up",
                      text: t("kpi.tokensDelta", { count: summary.traces_total.toLocaleString() }),
                      tone: "muted",
                    }}
                    sparkSeed={53}
                    sparkTone="primary"
                  />
                </>
              ) : state === "loading" ? (
                <>
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
                  title={t("panels.langfuse")}
                  icon="shield-check"
                  rows={[
                    {
                      label: t("panels.rows.bootstrap"),
                      value: statusLabel(summary.bootstrap_status),
                      tone: tone,
                    },
                    {
                      label: t("panels.rows.observability"),
                      value: summary.observability_enabled ? t("panels.values.enabled") : t("panels.values.disabled"),
                      tone: summary.observability_enabled ? "success" : "warning",
                    },
                    {
                      label: t("panels.rows.host"),
                      value: summary.host ?? "—",
                      tone: "muted",
                    },
                    {
                      label: t("panels.rows.totalTraces"),
                      value: summary.traces_total.toLocaleString(),
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
                          value: t("panels.values.runs", { count: row.runs_count.toLocaleString() }),
                        }))
                      : []
                  }
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
                            <span>{row.tokens.toLocaleString()} {t("incidents.tokensSuffix")}</span>
                            <span className="hidden md:inline">{formatDate(row.started_at)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* TRACES */}
              <section>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-[18px] font-semibold tracking-tight text-text flex items-center gap-2">
                    <Icon name="activity" size={16} className="text-primary" />
                    {t("traces.title")}
                  </h2>
                  <div className="inline-flex items-center gap-2 text-[11px] font-mono text-text-subtle">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${toneDot}`} />
                    {t("bootstrap.headlinePrefix")} {statusLabel(summary.bootstrap_status)}
                  </div>
                </div>

                {traces.length === 0 ? (
                  <EmptyState
                    title={t("traces.empty.title")}
                    description={t("traces.empty.description")}
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
                        {traces.map((row) => (
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
                            <td className="py-2.5 px-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                              {row.tokens.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-4 text-text-muted">
                              {formatDate(row.started_at)}
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
    </AppShell>
  );
}
