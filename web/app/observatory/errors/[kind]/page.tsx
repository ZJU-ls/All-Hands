"use client";

/**
 * /observatory/errors/[kind] · Per-error-category drill-down (L2 layer).
 *
 * Sentry-style: groups failed runs by error_kind, shows count + last
 * message + sample failed traces. Users land here from the ErrorsPanel
 * row click on the global page.
 */

import { useEffect, useMemo, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/ui/icon";
import { TraceChip } from "@/components/runs/TraceChip";
import {
  fetchObservatorySummary,
  fetchTraces,
  type ObservatorySummaryDto,
  type TraceSummaryDto,
} from "@/lib/observatory-api";

export default function ErrorDetailPage({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind: encoded } = use(params);
  const errorKind = decodeURIComponent(encoded);
  const t = useTranslations("pages.observatory");
  const tErr = useTranslations("pages.observatory.errorDetail");
  const locale = useLocale();
  const [summary, setSummary] = useState<ObservatorySummaryDto | null>(null);
  const [failedTraces, setFailedTraces] = useState<TraceSummaryDto[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    Promise.all([
      fetchObservatorySummary({}),
      fetchTraces({ status: "failed", limit: 100 }),
    ])
      .then(([s, t]) => {
        if (cancelled) return;
        setSummary(s);
        setFailedTraces(t.traces);
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

  const errorMeta = useMemo(
    () => summary?.top_errors.find((e) => e.error_kind === errorKind) ?? null,
    [summary, errorKind],
  );

  return (
    <AppShell title={`${tErr("breadcrumb")} · ${errorKind}`}>
      <div className="h-full overflow-y-auto bg-bg">
        <div className="mx-auto max-w-[1100px] px-6 md:px-8 py-8 space-y-6">
          <div className="flex items-center gap-2 text-[12px] text-text-subtle font-mono">
            <Link href="/observatory" className="hover:text-primary">
              {t("title")}
            </Link>
            <Icon name="chevron-right" size={11} />
            <span>{tErr("breadcrumb")}</span>
            <Icon name="chevron-right" size={11} />
            <span className="font-semibold text-text">{errorKind}</span>
          </div>

          <header className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-danger-soft text-danger">
              <Icon name="alert-triangle" size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.18em] font-mono text-danger">
                {tErr("eyebrow")}
              </div>
              <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-text font-mono">
                {errorKind}
              </h1>
              <p className="mt-0.5 text-[12.5px] text-text-muted">
                {tErr("subtitle")}
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

          {state === "ok" && (
            <>
              {errorMeta ? (
                <>
                  <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Tile
                      label={tErr("kpi.count")}
                      value={errorMeta.count.toLocaleString(locale)}
                    />
                    <Tile
                      label={tErr("kpi.lastSeen")}
                      value={
                        errorMeta.last_seen_at
                          ? new Date(errorMeta.last_seen_at).toLocaleString(locale)
                          : "—"
                      }
                    />
                    <Tile
                      label={tErr("kpi.severity")}
                      value={
                        errorMeta.count >= 10
                          ? tErr("severityHigh")
                          : errorMeta.count >= 3
                            ? tErr("severityMid")
                            : tErr("severityLow")
                      }
                      tone={
                        errorMeta.count >= 10
                          ? "danger"
                          : errorMeta.count >= 3
                            ? "warning"
                            : "success"
                      }
                    />
                  </section>

                  {errorMeta.last_message && (
                    <section className="rounded-xl border border-danger/20 bg-danger-soft/30 px-5 py-4">
                      <div className="text-[10px] uppercase tracking-wider font-mono text-danger mb-2">
                        {tErr("lastMessage")}
                      </div>
                      <pre className="text-[12px] text-text whitespace-pre-wrap font-mono leading-relaxed">
                        {errorMeta.last_message}
                      </pre>
                    </section>
                  )}
                </>
              ) : (
                <div className="rounded-xl border border-border bg-surface px-5 py-6 text-[13px] text-text-muted">
                  {tErr("notSeen")}
                </div>
              )}

              <section>
                <h2 className="text-[16px] font-semibold mb-3 flex items-center gap-2">
                  <Icon name="activity" size={16} className="text-danger" />
                  {tErr("recentFailures")}
                </h2>
                <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-text-subtle">
                      <tr>
                        <th className="text-left py-2 px-3">trace</th>
                        <th className="text-left py-2 px-3">employee</th>
                        <th className="text-left py-2 px-3">model</th>
                        <th className="text-right py-2 px-3">duration</th>
                        <th className="text-left py-2 px-3">started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failedTraces.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="text-center py-6 text-text-muted"
                          >
                            {tErr("noFailures")}
                          </td>
                        </tr>
                      ) : (
                        failedTraces.map((tr) => (
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
                            <td className="py-2 px-3">
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
                            <td className="py-2 px-3 font-mono text-[11px] text-text-muted">
                              {tr.model_ref ? (
                                <Link
                                  href={`/observatory/models/${encodeURIComponent(tr.model_ref)}`}
                                  className="hover:text-primary"
                                >
                                  {tr.model_ref}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-[11px] tabular-nums text-text-muted">
                              {tr.duration_s !== null
                                ? tr.duration_s < 1
                                  ? `${(tr.duration_s * 1000).toFixed(0)}ms`
                                  : `${tr.duration_s.toFixed(2)}s`
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
      <div className={`mt-1 text-[20px] font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
    </div>
  );
}
