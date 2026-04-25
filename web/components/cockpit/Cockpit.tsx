"use client";

/**
 * Cockpit · "Mission control" for an allhands workspace.
 *
 * Scope (per product direction 2026-04-22):
 *   - Observe live runtime state (active runs, event flow, KPIs)
 *   - Control _already-defined_ flows (pause/resume, refresh, approvals)
 *   - NEVER host resource definitions (employees / skills / MCP / triggers
 *     CRUD lives on its own dedicated page; the cockpit only links out).
 *
 * Layout (V2 Azure Live · ADR 0016): HUD greeting card → 4×2 KPI grid →
 * 2-column main (activity feed | active runs) with a 44px right-edge
 * DrawerRail hosting secondary observation panels (Health · Budget ·
 * Convs). Runtime ops live on the HUD's right cluster.
 *
 * Visual language is Brand Blue Dual Theme: rounded-xl cards,
 * `shadow-soft-sm` elevation with `hover:-translate-y-px` lift, tokenised
 * colors only, icons via `<Icon>`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
import { Coachmark } from "@/components/ui/Coachmark";
import { DotGridBackdrop } from "@/components/ui/DotGridBackdrop";
import {
  cockpitStreamUrl,
  getCockpitSummary,
  pauseAllRuns,
  resumeAllRuns,
  type ActivityEventDto,
  type WorkspaceSummaryDto,
} from "@/lib/cockpit-api";
import { ActiveRunsList } from "./ActiveRunsList";
import { ActivityFeed } from "./ActivityFeed";
import { DrawerRail } from "./DrawerRail";
import { HUD } from "./HUD";
import { KpiBar } from "./KpiBar";

type StreamFrame = {
  id?: string;
  kind?: string;
  ts?: string;
  payload?: Record<string, unknown>;
};

type ConnectionState = "connecting" | "open" | "error";

const MAX_RECENT_EVENTS = 50;

export function Cockpit() {
  const t = useTranslations("cockpit.shell");
  const [summary, setSummary] = useState<WorkspaceSummaryDto | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const scheduleRefresh = useCallback(() => {
    if (cancelledRef.current) return;
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (cancelledRef.current) return;
      getCockpitSummary()
        .then((s) => {
          if (!cancelledRef.current) setSummary(s);
        })
        .catch(() => {
          /* keep last good snapshot; stream-level error surfaces separately */
        });
    }, 120);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    void getCockpitSummary()
      .then((s) => {
        if (!cancelledRef.current && !summary) setSummary(s);
      })
      .catch(() => undefined);

    const source = new EventSource(cockpitStreamUrl());

    source.addEventListener("open", () => {
      if (cancelledRef.current) return;
      setConnection("open");
      setStreamError(null);
    });

    source.addEventListener("RUN_STARTED", () => {
      if (cancelledRef.current) return;
      setConnection("open");
      setStreamError(null);
    });

    const applyActivity = (frame: StreamFrame, refresh: boolean) => {
      const activity = buildActivityEvent(frame);
      if (!activity) return;
      setSummary((prev) => {
        if (!prev) return prev;
        const existing = prev.recent_events ?? [];
        if (existing.some((e) => e.id === activity.id)) return prev;
        return {
          ...prev,
          recent_events: [activity, ...existing].slice(0, MAX_RECENT_EVENTS),
        };
      });
      if (refresh) scheduleRefresh();
    };

    source.addEventListener("CUSTOM", (evt) => {
      if (cancelledRef.current) return;
      let data: { name?: string; value?: unknown };
      try {
        data = JSON.parse((evt as MessageEvent).data) as {
          name?: string;
          value?: unknown;
        };
      } catch {
        return;
      }
      const name = data.name ?? "";
      const value = data.value;

      if (name === "allhands.cockpit_snapshot") {
        try {
          setSummary(value as WorkspaceSummaryDto);
          setConnection("open");
          setStreamError(null);
        } catch {
          setStreamError("failed to parse snapshot frame");
        }
        return;
      }
      if (name === "allhands.heartbeat") {
        if (connection !== "open") setConnection("open");
        return;
      }
      if (name === "allhands.cockpit_activity" || name === "allhands.cockpit_run_update") {
        applyActivity((value ?? {}) as StreamFrame, false);
        return;
      }
      if (name === "allhands.cockpit_run_done") {
        applyActivity((value ?? {}) as StreamFrame, true);
        return;
      }
      if (name === "allhands.cockpit_health" || name === "allhands.cockpit_kpi") {
        scheduleRefresh();
        return;
      }
    });

    source.addEventListener("RUN_ERROR", (evt) => {
      if (cancelledRef.current) return;
      let msg = t("streamEnded");
      try {
        const data = JSON.parse((evt as MessageEvent).data) as { message?: string };
        if (data.message) msg = data.message;
      } catch {
        /* default message kept */
      }
      setConnection("error");
      setStreamError(msg);
    });

    source.addEventListener("error", () => {
      if (cancelledRef.current) return;
      setConnection("error");
      setStreamError(t("streamReconnecting"));
    });

    return () => {
      cancelledRef.current = true;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleRefresh]);

  const onPauseConfirm = useCallback(async () => {
    setPauseBusy(true);
    try {
      await pauseAllRuns(t("estopReason"), `ui-${Date.now()}`);
      scheduleRefresh();
      setConfirmOpen(false);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setPauseBusy(false);
    }
  }, [scheduleRefresh, t]);

  const onResume = useCallback(async () => {
    try {
      await resumeAllRuns();
      scheduleRefresh();
    } catch (e) {
      setActionError(String(e));
    }
  }, [scheduleRefresh]);

  const onRetryConnection = useCallback(() => {
    setStreamError(null);
    setConnection("connecting");
    scheduleRefresh();
  }, [scheduleRefresh]);

  const isLoading = summary === null && connection !== "error";

  return (
    <AppShell title={t("title")}>
      <div className="relative h-full flex overflow-hidden">
        {/* Soft primary wash + dot grid to echo V2's Azure Live hero. The
         *  gradient is pure CSS variables so theme pack swap re-colours it. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(1100px 540px at 12% -10%, var(--color-primary-muted), transparent 60%), radial-gradient(900px 500px at 92% 4%, var(--color-primary-soft), transparent 60%)",
            opacity: 0.9,
          }}
        />
        <DotGridBackdrop opacity={0.18} fade={false} />

        <div className="relative flex-1 min-w-0 overflow-y-auto">
          <div className="p-6 space-y-5 min-h-full flex flex-col">
            {actionError && (
              <ErrorState
                title={t("actionFailed")}
                detail={actionError}
                action={{ label: t("closeAction"), onClick: () => setActionError(null) }}
              />
            )}
            {streamError && (
              <ErrorState
                title={t("streamErrorTitle")}
                description={streamError}
                action={{ label: t("retryNow"), onClick: onRetryConnection }}
              />
            )}
            {isLoading ? (
              <LoadingState
                title={t("loadingTitle")}
                description={t("loadingDescription")}
              />
            ) : summary === null ? (
              <ErrorState
                title={t("loadFailTitle")}
                description={t("loadFailDescription")}
                action={{ label: t("retry"), onClick: onRetryConnection }}
              />
            ) : (
              <>
                <HUD
                  summary={summary}
                  connection={connection}
                  onPauseRequest={() => setConfirmOpen(true)}
                  onResume={() => void onResume()}
                  onRefresh={onRetryConnection}
                />
                <KpiBar summary={summary} />
                {isWorkspaceEmpty(summary) ? (
                  <div className="relative flex-1 flex items-center justify-center rounded-xl border border-border bg-surface px-6 py-12 overflow-hidden min-h-[50vh] shadow-soft-sm">
                    <DotGridBackdrop opacity={0.22} />
                    <div className="relative mx-auto max-w-md">
                      <EmptyState
                        title={t("emptyTitle")}
                        description={t("emptyDescription")}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <Coachmark
                      id="cockpit-activity"
                      title={t("coachmarkTitle")}
                      description={t("coachmarkDescription")}
                    />
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 flex-1 min-h-[55vh]">
                      <ActivityFeed events={summary.recent_events} />
                      <ActiveRunsList runs={summary.active_runs} />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {summary && <DrawerRail summary={summary} />}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t("estopTitle")}
        message={t("estopMessage")}
        danger
        busy={pauseBusy}
        confirmLabel={t("estopConfirm")}
        onConfirm={() => void onPauseConfirm()}
        onCancel={() => setConfirmOpen(false)}
      />
    </AppShell>
  );
}

function isWorkspaceEmpty(s: WorkspaceSummaryDto): boolean {
  return (
    s.active_runs.length === 0 &&
    s.recent_events.length === 0 &&
    s.recent_conversations.length === 0 &&
    s.employees_total === 0
  );
}

function buildActivityEvent(frame: StreamFrame): ActivityEventDto | null {
  if (!frame.id || !frame.kind) return null;
  const p = frame.payload ?? {};
  const severity =
    typeof p.severity === "string" && (p.severity === "info" || p.severity === "warn" || p.severity === "error")
      ? p.severity
      : frame.kind === "run.cancelled"
        ? "warn"
        : "info";
  const summary =
    typeof p.summary === "string"
      ? p.summary
      : `${frame.kind} · ${frame.id.slice(0, 8)}`;
  return {
    id: frame.id,
    ts: frame.ts ?? new Date().toISOString(),
    kind: frame.kind,
    actor: typeof p.actor === "string" ? p.actor : null,
    subject: typeof p.subject === "string" ? p.subject : null,
    summary,
    severity,
    link: typeof p.link === "string" ? p.link : null,
  };
}
