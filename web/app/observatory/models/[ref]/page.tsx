"use client";

/**
 * /observatory/models/[ref] · Per-model drill-down (L2 layer).
 *
 * Pivots the dashboard around one model_ref. Same widgets as the global
 * page but every metric / panel / trace list scopes to that model. The
 * "Top employees using this model" panel reverses the global page's
 * "Top models for this employee" view — ergo navigation is symmetric.
 */

import { useEffect, useMemo, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
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

type State = "loading" | "ok" | "error";

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

export default function ModelDetailPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref: encodedRef } = use(params);
  const modelRef = decodeURIComponent(encodedRef);
  const t = useTranslations("pages.observatory");
  const tMod = useTranslations("pages.observatory.modelDetail");
  // The model L2 reuses the employee L2 run-table headers + status labels
  // verbatim — rather than duplicating the keys we share the namespace.
  const tTable = useTranslations("pages.observatory.employeeDetail");
  const locale = useLocale();
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
      fetchObservatorySummary({ model_ref: modelRef }),
      fetchTraces({ model_ref: modelRef, limit: 50 }),
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
  }, [modelRef]);

  const modelMeta = useMemo(() => {
    return summary?.by_model.find((m) => m.model_ref === modelRef) ?? null;
  }, [summary, modelRef]);

  return (
    <AppShell title={`${tMod("breadcrumb")} · ${modelRef}`}>
      <div className="h-full overflow-y-auto bg-bg">
        <div className="mx-auto max-w-[1400px] px-6 md:px-8 py-8 space-y-6">
          <div className="flex items-center gap-2 text-[12px] text-text-subtle font-mono">
            <Link href="/observatory" className="hover:text-primary">
              {t("title")}
            </Link>
            <Icon name="chevron-right" size={11} />
            <span className="text-text">{tMod("breadcrumb")}</span>
            <Icon name="chevron-right" size={11} />
            <span className="font-semibold text-text">{modelRef}</span>
          </div>

          <header className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary-muted text-primary">
              <Icon name="brain" size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.18em] font-mono text-primary">
                {tMod("eyebrow")}
              </div>
              <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-text font-mono">
                {modelRef}
              </h1>
              <p className="mt-0.5 text-[12.5px] text-text-muted">
                {tMod("subtitle", { ref: modelRef })}
              </p>
            </div>
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
              <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <Tile
                  label={tMod("kpi.runs")}
                  value={traces.length.toLocaleString(locale)}
                  onClick={() => setDrawerMetric("runs")}
                />
                <Tile
                  label={tMod("kpi.failureRate")}
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
                <Tile
                  label={tMod("kpi.latencyP50")}
                  value={formatDuration(summary.latency_p50_s)}
                  onClick={() => setDrawerMetric("latency_p50")}
                />
                <Tile
                  label={tMod("kpi.calls")}
                  value={summary.llm_calls_total.toLocaleString(locale)}
                  onClick={() => setDrawerMetric("llm_calls")}
                />
                <Tile
                  label={tMod("kpi.tokens")}
                  value={formatTokens(summary.total_tokens_total)}
                  hint={`in ${formatTokens(summary.input_tokens_total)} · out ${formatTokens(summary.output_tokens_total)}`}
                  onClick={() => setDrawerMetric("tokens_total")}
                />
                <Tile
                  label={tMod("kpi.cost")}
                  value={
                    summary.estimated_cost_usd > 0
                      ? `$${summary.estimated_cost_usd.toFixed(4)}`
                      : "—"
                  }
                  onClick={() => setDrawerMetric("cost")}
                />
              </section>

              {modelMeta && modelMeta.estimated_cost_usd === 0 && modelMeta.total_tokens > 0 ? (
                <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-[12px] text-warning">
                  <Icon name="alert-triangle" size={13} className="inline mr-1.5" />
                  {tMod("pricingMissing")}
                </div>
              ) : null}

              <section>
                <CostPanel
                  totalUsd={summary.estimated_cost_usd}
                  byEmployee={summary.by_employee}
                  byModel={summary.by_model}
                  onClickDrillDown={() => setDrawerMetric("cost")}
                />
              </section>

              <section>
                <h2 className="text-[16px] font-semibold mb-3 flex items-center gap-2">
                  <Icon name="users" size={16} className="text-primary" />
                  {tMod("topEmployeesTitle")}
                </h2>
                <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
                  {summary.by_employee.length === 0 ? (
                    <div className="px-5 py-6 text-[12px] text-text-muted">
                      {tMod("topEmployeesEmpty")}
                    </div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {summary.by_employee.map((e) => (
                        <li key={e.employee_id}>
                          <Link
                            href={`/observatory/employees/${encodeURIComponent(e.employee_id)}`}
                            className="flex items-center gap-3 px-5 h-11 hover:bg-surface-2 transition-colors"
                          >
                            <span className="text-[12.5px] truncate flex-1">
                              {e.employee_name}
                            </span>
                            <span className="font-mono text-[11px] tabular-nums text-text-muted">
                              {e.runs_count} · {formatTokens(e.total_tokens)}
                            </span>
                            <span className="font-mono text-[11px] tabular-nums text-text-subtle w-16 text-right">
                              {e.estimated_cost_usd > 0
                                ? `$${e.estimated_cost_usd.toFixed(4)}`
                                : "—"}
                            </span>
                            <Icon
                              name="chevron-right"
                              size={11}
                              className="text-text-subtle"
                            />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section>
                <LatencyHeatmap
                  cells={summary.latency_heatmap}
                  buckets={summary.latency_heatmap_buckets_s}
                />
              </section>

              <section>
                <h2 className="text-[16px] font-semibold mb-3 flex items-center gap-2">
                  <Icon name="activity" size={16} className="text-primary" />
                  {t("traces.title")}
                </h2>
                <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-text-subtle">
                      <tr>
                        <th className="text-left py-2 px-3">{tTable("table.trace")}</th>
                        <th className="text-left py-2 px-3">{tTable("table.employee")}</th>
                        <th className="text-left py-2 px-3">{tTable("table.status")}</th>
                        <th className="text-right py-2 px-3">{tTable("table.duration")}</th>
                        <th className="text-right py-2 px-3">{tTable("table.tokens")}</th>
                        <th className="text-left py-2 px-3">{tTable("table.started")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traces.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="text-center py-6 text-text-muted"
                          >
                            {t("traces.empty.description")}
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
                            <td className="py-2 px-3 text-text">
                              {tr.employee_id ? (
                                <Link
                                  href={`/observatory/employees/${encodeURIComponent(tr.employee_id)}`}
                                  className="hover:text-primary"
                                >
                                  {tr.employee_name ?? tr.employee_id}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-2 px-3">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                  tr.status === "failed"
                                    ? "bg-danger-soft text-danger"
                                    : tr.status === "running"
                                      ? "bg-warning-soft text-warning"
                                      : "bg-success-soft text-success"
                                }`}
                              >
                                {tTable(`status.${tr.status}`)}
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
                              {new Date(tr.started_at).toLocaleString(locale)}
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
        contextLabel={`${modelRef} · ${tMod("scopedToModel")}`}
        scope={{ model_ref: modelRef }}
        onClose={() => setDrawerMetric(null)}
      />
    </AppShell>
  );
}

function Tile({
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
