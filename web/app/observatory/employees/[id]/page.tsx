"use client";

/**
 * /observatory/employees/[id] · Per-employee drill-down (L2 layer).
 *
 * Pivots the entire observatory page around one employee_id — all KPIs,
 * panels, time-series, and the trace list scope to that employee. Pattern
 * stolen from Datadog APM's per-service page: same widgets as the global
 * dashboard, only the data source narrows.
 */

import { useEffect, useMemo, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/ui/icon";
import { TraceChip } from "@/components/runs/TraceChip";
import { MetricDrawer } from "@/components/observatory/MetricDrawer";
import { CostPanel } from "@/components/observatory/CostPanel";
import { LatencyHeatmap } from "@/components/observatory/LatencyHeatmap";
import {
  fetchObservatorySummary,
  fetchTraces,
  type ObservatoryMetric,
  type ObservatorySummaryDto,
  type TraceSummaryDto,
} from "@/lib/observatory-api";

type State = "idle" | "loading" | "ok" | "error";

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function formatDuration(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  if (s < 1) return `${(s * 1000).toFixed(0)}ms`;
  return `${s.toFixed(2)}s`;
}
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export default function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: employeeId } = use(params);
  const t = useTranslations("pages.observatory");
  const tEmp = useTranslations("pages.observatory.employeeDetail");
  const [summary, setSummary] = useState<ObservatorySummaryDto | null>(null);
  const [traces, setTraces] = useState<TraceSummaryDto[]>([]);
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);
  const [drawerMetric, setDrawerMetric] = useState<ObservatoryMetric | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    Promise.all([
      fetchObservatorySummary({ employee_id: employeeId }),
      fetchTraces({ employee_id: employeeId, limit: 50 }),
    ])
      .then(([s, t]) => {
        if (cancelled) return;
        setSummary(s);
        setTraces(t.traces);
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
  }, [employeeId]);

  const employeeName = useMemo(() => {
    if (!summary) return employeeId;
    const row = summary.by_employee.find((e) => e.employee_id === employeeId);
    return row?.employee_name ?? employeeId;
  }, [summary, employeeId]);

  return (
    <AppShell title={`${tEmp("title")} · ${employeeName}`}>
      <div className="h-full overflow-y-auto bg-bg">
        <div className="mx-auto max-w-[1400px] px-6 md:px-8 py-8 space-y-6">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-[12px] text-text-subtle font-mono">
            <Link href="/observatory" className="hover:text-primary">
              {t("title")}
            </Link>
            <Icon name="chevron-right" size={11} />
            <span className="text-text">{tEmp("breadcrumb")}</span>
            <Icon name="chevron-right" size={11} />
            <span className="font-semibold text-text">{employeeName}</span>
          </div>

          {/* Hero */}
          <header className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary-muted text-primary text-[18px] font-semibold">
              {employeeName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.18em] font-mono text-primary">
                {tEmp("eyebrow")}
              </div>
              <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-text">
                {employeeName}
              </h1>
              <p className="mt-0.5 text-[12.5px] text-text-muted">
                {tEmp("subtitle", { id: employeeId })}
              </p>
            </div>
            <Link
              href={`/conversations?employee_id=${encodeURIComponent(employeeId)}`}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-border text-[12px] hover:bg-surface-2"
            >
              <Icon name="message-square" size={12} />
              {tEmp("viewConversations")}
            </Link>
          </header>

          {state === "loading" && (
            <div className="rounded-xl border border-border bg-surface px-5 py-8 text-center text-[12px] text-text-muted">
              <Icon name="loader" size={14} className="inline mr-2 animate-spin" />
              {t("refreshing")}
            </div>
          )}

          {state === "error" && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">
              {error ?? t("loadFailed.fallback")}
            </div>
          )}

          {state === "ok" && summary && (
            <>
              {/* KPI strip · same shape as the global page but scoped */}
              <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiTile
                  label={tEmp("kpi.runs")}
                  value={traces.length.toLocaleString()}
                  onClick={() => setDrawerMetric("runs")}
                />
                <KpiTile
                  label={tEmp("kpi.failureRate")}
                  value={formatPct(summary.failure_rate_24h)}
                  tone={
                    summary.failure_rate_24h > 0.05
                      ? "danger"
                      : summary.failure_rate_24h > 0.02
                        ? "warning"
                        : "success"
                  }
                  onClick={() => setDrawerMetric("failure_rate")}
                />
                <KpiTile
                  label={tEmp("kpi.latencyP50")}
                  value={formatDuration(summary.latency_p50_s)}
                  onClick={() => setDrawerMetric("latency_p50")}
                />
                <KpiTile
                  label={tEmp("kpi.latencyP95")}
                  value={formatDuration(summary.latency_p95_s)}
                  onClick={() => setDrawerMetric("latency_p95")}
                />
                <KpiTile
                  label={tEmp("kpi.tokens")}
                  value={formatTokens(summary.total_tokens_total)}
                  hint={`in ${formatTokens(summary.input_tokens_total)} · out ${formatTokens(summary.output_tokens_total)}`}
                  onClick={() => setDrawerMetric("tokens_total")}
                />
                <KpiTile
                  label={tEmp("kpi.cost")}
                  value={
                    summary.estimated_cost_usd > 0
                      ? `$${summary.estimated_cost_usd.toFixed(4)}`
                      : "—"
                  }
                  onClick={() => setDrawerMetric("cost")}
                />
              </section>

              {/* Cost panel scoped to this employee */}
              <section>
                <CostPanel
                  totalUsd={summary.estimated_cost_usd}
                  byEmployee={summary.by_employee}
                  byModel={summary.by_model}
                  onClickDrillDown={() => setDrawerMetric("cost")}
                />
              </section>

              {/* Two-col: byModel that this employee uses + tools */}
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ScopedTable
                  title={tEmp("modelsUsedTitle")}
                  empty={tEmp("modelsUsedEmpty")}
                  rows={summary.by_model.map((m) => ({
                    primary: m.model_ref,
                    secondary: `${m.runs_count} · ${formatTokens(m.total_tokens)}`,
                    tertiary:
                      m.estimated_cost_usd > 0
                        ? `$${m.estimated_cost_usd.toFixed(4)}`
                        : "—",
                    href: `/observatory/models/${encodeURIComponent(m.model_ref)}`,
                  }))}
                />
                <ScopedTable
                  title={tEmp("toolsUsedTitle")}
                  empty={tEmp("toolsUsedEmpty")}
                  rows={summary.by_tool.map((tl) => ({
                    primary: tl.tool_id,
                    secondary: `${tl.invocations} ${tEmp("inv")}`,
                    tertiary: `${(tl.failure_rate * 100).toFixed(1)}%`,
                  }))}
                />
              </section>

              {/* Latency heatmap scoped */}
              <section>
                <LatencyHeatmap
                  cells={summary.latency_heatmap}
                  buckets={summary.latency_heatmap_buckets_s}
                />
              </section>

              {/* Recent traces by this employee */}
              <section>
                <h2 className="text-[16px] font-semibold mb-3 flex items-center gap-2">
                  <Icon name="activity" size={16} className="text-primary" />
                  {tEmp("recentRuns", { n: traces.length })}
                </h2>
                <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-text-subtle">
                      <tr>
                        <th className="text-left py-2 px-3">trace</th>
                        <th className="text-left py-2 px-3">{tEmp("model")}</th>
                        <th className="text-left py-2 px-3">status</th>
                        <th className="text-right py-2 px-3">duration</th>
                        <th className="text-right py-2 px-3">tokens</th>
                        <th className="text-left py-2 px-3">started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traces.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="text-center py-6 text-text-muted"
                          >
                            {tEmp("noRuns")}
                          </td>
                        </tr>
                      ) : (
                        traces.map((tr) => (
                          <tr
                            key={tr.trace_id}
                            className="border-t border-border hover:bg-surface-2"
                          >
                            <td className="py-2 px-3">
                              <TraceChip
                                runId={tr.trace_id}
                                label={tr.trace_id.slice(0, 12)}
                              />
                            </td>
                            <td className="py-2 px-3 font-mono text-[11px] text-text-muted">
                              {tr.model_ref ?? "—"}
                            </td>
                            <td className="py-2 px-3">
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                  tr.status === "failed"
                                    ? "bg-danger-soft text-danger"
                                    : tr.status === "running"
                                      ? "bg-warning-soft text-warning"
                                      : "bg-success-soft text-success"
                                }`}
                              >
                                {tr.status}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-[11px] tabular-nums text-text-muted">
                              {formatDuration(tr.duration_s)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-[11px] tabular-nums text-text-muted">
                              {tr.tokens.total > 0
                                ? formatTokens(tr.tokens.total)
                                : "—"}
                            </td>
                            <td className="py-2 px-3 font-mono text-[11px] text-text-muted">
                              {new Date(tr.started_at).toLocaleString()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      <MetricDrawer
        open={drawerMetric !== null}
        metric={drawerMetric}
        contextLabel={`${employeeName} · ${tEmp("scopedToEmployee")}`}
        scope={{ employee_id: employeeId }}
        onClose={() => setDrawerMetric(null)}
      />
    </AppShell>
  );
}

function KpiTile({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "success" | "warning" | "danger";
  onClick?: () => void;
}) {
  const valTone =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "success"
          ? "text-success"
          : "text-text";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`text-left rounded-xl border border-border bg-surface px-4 py-3 shadow-soft-sm ${
        onClick
          ? "hover:-translate-y-px hover:shadow-soft hover:border-border-strong transition cursor-pointer"
          : ""
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider font-mono text-text-subtle">
        {label}
      </div>
      <div
        className={`mt-1 text-[22px] font-semibold tabular-nums ${valTone}`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-text-subtle">{hint}</div>}
    </Tag>
  );
}

function ScopedTable({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: { primary: string; secondary: string; tertiary?: string; href?: string }[];
}) {
  return (
    <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
      <div className="px-5 h-11 flex items-center border-b border-border text-[13px] font-semibold">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-6 text-[12px] text-text-muted">{empty}</div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r, i) => {
            const Inner = (
              <>
                <span className="font-mono text-[12px] truncate">
                  {r.primary}
                </span>
                <span className="ml-auto font-mono text-[11px] tabular-nums text-text-muted whitespace-nowrap">
                  {r.secondary}
                </span>
                {r.tertiary && (
                  <span className="font-mono text-[11px] tabular-nums text-text-subtle whitespace-nowrap">
                    {r.tertiary}
                  </span>
                )}
              </>
            );
            return (
              <li key={`${r.primary}-${i}`}>
                {r.href ? (
                  <Link
                    href={r.href}
                    className="flex items-center gap-3 px-5 h-10 hover:bg-surface-2 transition-colors"
                  >
                    {Inner}
                    <Icon
                      name="chevron-right"
                      size={11}
                      className="text-text-subtle"
                    />
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-5 h-10 hover:bg-surface-2 transition-colors">
                    {Inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
