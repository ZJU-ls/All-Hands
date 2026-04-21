"use client";

import { useEffect, useState, useTransition } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
import {
  fetchObservatorySummary,
  fetchTraces,
  retryBootstrap,
  type BootstrapStatus,
  type ObservatorySummaryDto,
  type TraceSummaryDto,
} from "@/lib/observatory-api";

type LoadState = "idle" | "loading" | "ok" | "error";

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

function statusDotClass(s: BootstrapStatus): string {
  if (s === "ok" || s === "external") return "bg-success";
  if (s === "pending") return "bg-warning";
  return "bg-danger";
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 border-b border-border last:border-b-0">
      <div className="font-mono text-[9px] uppercase tracking-wider text-text-subtle">
        {label}
      </div>
      <div className="text-base font-semibold tabular-nums text-text">{value}</div>
      {hint ? (
        <div className="text-[11px] text-text-muted">{hint}</div>
      ) : null}
    </div>
  );
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatDuration(s: number | null): string {
  if (s === null || s === undefined) return "—";
  if (s < 1) return `${(s * 1000).toFixed(0)}ms`;
  return `${s.toFixed(2)}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export default function ObservatoryPage() {
  const [summary, setSummary] = useState<ObservatorySummaryDto | null>(null);
  const [traces, setTraces] = useState<TraceSummaryDto[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, startRetry] = useTransition();

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

  return (
    <AppShell title="观测中心">
      <div className="h-full flex flex-col">
        {summary && !summary.observability_enabled ? (
          <div
            role="alert"
            className="border-b border-border bg-surface-2 px-6 py-3 flex items-start justify-between gap-4"
          >
            <div className="text-[12px] text-text-muted max-w-3xl">
              <div className="font-semibold text-text mb-0.5">
                Langfuse {statusLabel(summary.bootstrap_status)} · 追踪未连上
              </div>
              <div>
                Agent 运行照常,但每次 run 的 trace 会被丢弃。下方 Trace 列表
                读的是本地 events 表的 run.* 事件,不是 Langfuse。
                {summary.bootstrap_error ? (
                  <>
                    {" "}
                    <span className="text-text-subtle">
                      上次错误 · {summary.bootstrap_error}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            <button
              onClick={onRetry}
              disabled={isRetrying}
              className="shrink-0 self-start h-7 px-3 text-[12px] border border-border rounded-md bg-surface hover:border-border-strong text-text transition-colors duration-base disabled:opacity-50"
            >
              {isRetrying ? "重试中…" : "重试 bootstrap"}
            </button>
          </div>
        ) : null}

        <div className="flex-1 flex min-h-0">
          <aside className="w-72 shrink-0 border-r border-border bg-surface overflow-y-auto">
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`w-1.5 h-1.5 rounded-full ${summary ? statusDotClass(summary.bootstrap_status) : "bg-border"}`}
                />
                <div className="text-[12px] text-text">
                  Langfuse ·{" "}
                  <span className="text-text-muted">
                    {summary ? statusLabel(summary.bootstrap_status) : "…"}
                  </span>
                </div>
              </div>
              {summary?.host ? (
                <div className="mt-1 font-mono text-[10px] text-text-subtle truncate">
                  {summary.host}
                </div>
              ) : null}
            </div>

            <div className="px-5">
              {summary ? (
                <>
                  <Kpi
                    label="Traces total"
                    value={summary.traces_total.toLocaleString()}
                  />
                  <Kpi
                    label="Failure rate · 24h"
                    value={formatPct(summary.failure_rate_24h)}
                  />
                  <Kpi
                    label="Latency p50"
                    value={formatDuration(summary.latency_p50_s)}
                  />
                  <Kpi
                    label="Avg tokens / run"
                    value={summary.avg_tokens_per_run.toLocaleString()}
                  />
                </>
              ) : (
                <div className="py-3">
                  {state === "error" ? (
                    <ErrorState title="加载失败" detail={error ?? undefined} />
                  ) : (
                    <LoadingState title="加载观测数据" />
                  )}
                </div>
              )}
            </div>

            {summary && summary.by_employee.length > 0 ? (
              <div className="px-5 py-4 border-t border-border">
                <div className="font-mono text-[9px] uppercase tracking-wider text-text-subtle mb-2">
                  By employee · 24h
                </div>
                <ul className="space-y-1.5">
                  {summary.by_employee.slice(0, 8).map((row) => (
                    <li
                      key={row.employee_id}
                      className="flex items-center justify-between text-[12px]"
                    >
                      <span className="text-text truncate mr-2">
                        {row.employee_name}
                      </span>
                      <span className="font-mono text-[11px] text-text-muted tabular-nums">
                        {row.runs_count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>

          <section className="flex-1 min-w-0 overflow-y-auto">
            <div className="px-6 py-5">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold text-text">
                  近 50 条 trace
                </h2>
                <button
                  onClick={load}
                  disabled={state === "loading"}
                  className="h-7 px-3 text-[12px] border border-border rounded-md bg-surface hover:border-border-strong text-text transition-colors duration-base disabled:opacity-50"
                >
                  {state === "loading" ? "刷新中…" : "刷新"}
                </button>
              </div>

              {traces.length === 0 && state === "ok" ? (
                <EmptyState
                  title="还没有 run 事件"
                  description="和 Lead 对话发起第一条任务,这里会出现 trace 摘要。"
                />
              ) : (
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-border text-left text-text-subtle">
                      <th className="py-2 pr-4 font-mono text-[10px] uppercase tracking-wider font-medium">
                        trace
                      </th>
                      <th className="py-2 pr-4 font-mono text-[10px] uppercase tracking-wider font-medium">
                        employee
                      </th>
                      <th className="py-2 pr-4 font-mono text-[10px] uppercase tracking-wider font-medium">
                        status
                      </th>
                      <th className="py-2 pr-4 font-mono text-[10px] uppercase tracking-wider font-medium tabular-nums text-right">
                        duration
                      </th>
                      <th className="py-2 pr-4 font-mono text-[10px] uppercase tracking-wider font-medium tabular-nums text-right">
                        tokens
                      </th>
                      <th className="py-2 pr-0 font-mono text-[10px] uppercase tracking-wider font-medium">
                        started
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {traces.map((t) => (
                      <tr
                        key={t.trace_id}
                        className="border-b border-border hover:bg-surface-2 transition-colors duration-base"
                      >
                        <td className="py-2 pr-4 font-mono text-[11px] text-text-muted truncate max-w-[180px]">
                          {t.trace_id}
                        </td>
                        <td className="py-2 pr-4 text-text">
                          {t.employee_name ?? t.employee_id ?? "—"}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className={
                              t.status === "failed"
                                ? "text-danger"
                                : "text-text-muted"
                            }
                          >
                            {t.status}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                          {formatDuration(t.duration_s)}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                          {t.tokens.toLocaleString()}
                        </td>
                        <td className="py-2 pr-0 text-text-muted">
                          {formatDate(t.started_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
