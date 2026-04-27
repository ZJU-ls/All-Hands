"use client";

/**
 * /observatory/runs/[run_id] · L3 trace detail page.
 *
 * Replaces the global ?trace=<id> drawer with a proper observatory child
 * route. Five-tier drilldown closes the loop:
 *   L0 总览 → L1 维度面板 → L2 维度详情(employees/models/tools/errors)
 *   → L3 单条 trace(本页)→ L4 turn 级(panel 内)
 *
 * The page owns the RunDetail fetch so it can:
 *   1. render observatory breadcrumb + employee link in the header
 *   2. pass the resolved ``run`` prop into RunTracePanel to skip the refetch
 *
 * If the run isn't found yet (best-effort events lag), RunTracePanel renders
 * its own EmptyState — same UX the old drawer had.
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/ui/icon";
import { RunTracePanel } from "@/components/runs/RunTracePanel";
import {
  fetchRunDetail,
  RunNotFoundError,
  type RunDetailDto,
} from "@/lib/observatory-api";

type State =
  | { status: "loading" }
  | { status: "ready"; run: RunDetailDto }
  | { status: "not_found" }
  | { status: "error"; message: string };

export default function ObservatoryRunDetailPage({
  params,
}: {
  params: Promise<{ run_id: string }>;
}) {
  const { run_id: runId } = use(params);
  const t = useTranslations("pages.observatory.runDetail");
  const tBase = useTranslations("pages.observatory");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchRunDetail(runId)
      .then((run) => {
        if (cancelled) return;
        setState({ status: "ready", run });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof RunNotFoundError) {
          setState({ status: "not_found" });
        } else {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "load failed",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const shortId = runId.length > 12 ? `${runId.slice(0, 12)}…` : runId;
  const employeeId =
    state.status === "ready" ? state.run.employee_id : null;
  const employeeName =
    state.status === "ready" ? state.run.employee_name : null;

  return (
    <AppShell title={t("shellTitle", { id: shortId })}>
      <div
        data-testid="observatory-run-detail-page"
        className="mx-auto h-full w-full max-w-4xl overflow-y-auto px-6 py-6 space-y-4"
      >
        {/* Breadcrumb · observatory → [employee] → trace · <id> */}
        <nav
          aria-label={t("breadcrumb.aria")}
          className="flex flex-wrap items-center gap-1.5 font-mono text-[12px] text-text-subtle"
        >
          <Link href="/observatory" className="hover:text-primary">
            {tBase("title")}
          </Link>
          {employeeId ? (
            <>
              <Icon name="chevron-right" size={11} aria-hidden />
              <Link
                href={`/observatory/employees/${encodeURIComponent(employeeId)}`}
                className="hover:text-primary"
              >
                {employeeName ?? employeeId}
              </Link>
            </>
          ) : null}
          <Icon name="chevron-right" size={11} aria-hidden />
          <span className="text-text">{t("breadcrumb.trace")}</span>
          <span className="text-text-subtle">·</span>
          <span className="text-primary">{shortId}</span>
        </nav>

        {state.status === "ready" ? (
          <RunTracePanel run={state.run} />
        ) : (
          <RunTracePanel runId={runId} />
        )}
      </div>
    </AppShell>
  );
}
