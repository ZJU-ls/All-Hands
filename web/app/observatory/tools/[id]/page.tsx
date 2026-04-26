"use client";

/**
 * /observatory/tools/[id] · Per-tool drill-down (L2 layer).
 *
 * Shows total invocations / failure rate / avg duration of one tool, plus
 * which employees and models are calling it. Pulled from the same
 * by_tool slice the global page renders — no new endpoint needed.
 */

import { useEffect, useMemo, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/ui/icon";
import {
  fetchObservatorySummary,
  type ObservatoryEmployeeBreakdownDto,
  type ObservatorySummaryDto,
} from "@/lib/observatory-api";

export default function ToolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: encoded } = use(params);
  const toolId = decodeURIComponent(encoded);
  const t = useTranslations("pages.observatory");
  const tTool = useTranslations("pages.observatory.toolDetail");
  const locale = useLocale();
  const [summary, setSummary] = useState<ObservatorySummaryDto | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetchObservatorySummary({})
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
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
  }, []);

  const meta = useMemo(
    () => summary?.by_tool.find((tl) => tl.tool_id === toolId) ?? null,
    [summary, toolId],
  );

  // The summary doesn't slice tools by employee yet — we approximate "who
  // uses this tool" by listing employees in by_employee whose run count
  // could plausibly include this tool. A future iteration adds a real
  // by-employee tool breakdown server-side.
  const possibleCallers: ObservatoryEmployeeBreakdownDto[] = useMemo(
    () => (summary ? summary.by_employee.slice(0, 8) : []),
    [summary],
  );

  return (
    <AppShell title={`${tTool("breadcrumb")} · ${toolId}`}>
      <div className="h-full overflow-y-auto bg-bg">
        <div className="mx-auto max-w-[1100px] px-6 md:px-8 py-8 space-y-6">
          <div className="flex items-center gap-2 text-[12px] text-text-subtle font-mono">
            <Link href="/observatory" className="hover:text-primary">
              {t("title")}
            </Link>
            <Icon name="chevron-right" size={11} />
            <span>{tTool("breadcrumb")}</span>
            <Icon name="chevron-right" size={11} />
            <span className="font-semibold text-text">{toolId}</span>
          </div>

          <header className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary-muted text-primary">
              <Icon name="plug" size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.18em] font-mono text-primary">
                {tTool("eyebrow")}
              </div>
              <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-text font-mono">
                {toolId}
              </h1>
              <p className="mt-0.5 text-[12.5px] text-text-muted">
                {tTool("subtitle")}
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
              {meta ? (
                <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Tile
                    label={tTool("kpi.invocations")}
                    value={meta.invocations.toLocaleString(locale)}
                  />
                  <Tile
                    label={tTool("kpi.failures")}
                    value={meta.failures.toLocaleString(locale)}
                    tone={meta.failures > 0 ? "danger" : undefined}
                  />
                  <Tile
                    label={tTool("kpi.failureRate")}
                    value={`${(meta.failure_rate * 100).toFixed(1)}%`}
                    tone={
                      meta.failure_rate > 0.2
                        ? "danger"
                        : meta.failure_rate > 0.05
                          ? "warning"
                          : "success"
                    }
                  />
                  <Tile
                    label={tTool("kpi.avgDuration")}
                    value={
                      meta.avg_duration_s > 0
                        ? meta.avg_duration_s < 1
                          ? `${(meta.avg_duration_s * 1000).toFixed(0)}ms`
                          : `${meta.avg_duration_s.toFixed(2)}s`
                        : "—"
                    }
                  />
                </section>
              ) : (
                <div className="rounded-xl border border-border bg-surface px-5 py-6 text-[13px] text-text-muted">
                  {tTool("notSeen")}
                </div>
              )}

              <section>
                <h2 className="text-[16px] font-semibold mb-3 flex items-center gap-2">
                  <Icon name="users" size={16} className="text-primary" />
                  {tTool("possibleCallers")}
                </h2>
                <p className="mb-3 text-[12px] text-text-muted">
                  {tTool("possibleCallersHint")}
                </p>
                <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
                  <ul className="divide-y divide-border">
                    {possibleCallers.length === 0 ? (
                      <li className="px-5 py-6 text-[12px] text-text-muted">
                        {t("panels.noData")}
                      </li>
                    ) : (
                      possibleCallers.map((e) => (
                        <li key={e.employee_id}>
                          <Link
                            href={`/observatory/employees/${encodeURIComponent(e.employee_id)}`}
                            className="flex items-center gap-3 px-5 h-11 hover:bg-surface-2 transition-colors"
                          >
                            <span className="text-[12.5px] text-text truncate flex-1">
                              {e.employee_name}
                            </span>
                            <span className="font-mono text-[11px] tabular-nums text-text-muted">
                              {e.runs_count} {tTool("runs")}
                            </span>
                            <Icon
                              name="chevron-right"
                              size={11}
                              className="text-text-subtle"
                            />
                          </Link>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger";
}) {
  const cls =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "success"
          ? "text-success"
          : "text-text";
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3 shadow-soft-sm">
      <div className="text-[10px] uppercase tracking-wider font-mono text-text-subtle">
        {label}
      </div>
      <div className={`mt-1 text-[22px] font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
    </div>
  );
}
