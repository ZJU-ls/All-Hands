"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
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
import { BudgetSummary } from "./BudgetSummary";
import { HealthPanel } from "./HealthPanel";
import { KpiBar } from "./KpiBar";
import { QuickActions } from "./QuickActions";
import { RecentConvList } from "./RecentConvList";

type StreamFrame = {
  id?: string;
  kind?: string;
  ts?: string;
  payload?: Record<string, unknown>;
};

type ConnectionState = "connecting" | "open" | "error";

const MAX_RECENT_EVENTS = 50;

export function Cockpit() {
  const [summary, setSummary] = useState<WorkspaceSummaryDto | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);

  // Lazy refresher used when delta events (run_update / run_done / health /
  // kpi) arrive — the snapshot remains the source of truth; deltas just
  // prompt a re-read. Debounced so bursts of events don't thrash /summary.
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

    // Instant first paint — avoids a blank flash while SSE negotiates.
    // If this fails we stay in LoadingState until the stream snapshot lands.
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

    source.addEventListener("snapshot", (evt) => {
      if (cancelledRef.current) return;
      try {
        const snap = JSON.parse((evt as MessageEvent).data) as WorkspaceSummaryDto;
        setSummary(snap);
        setConnection("open");
        setStreamError(null);
      } catch {
        setStreamError("failed to parse snapshot frame");
      }
    });

    const onActivity = (evt: Event) => {
      if (cancelledRef.current) return;
      try {
        const frame = JSON.parse((evt as MessageEvent).data) as StreamFrame;
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
      } catch {
        /* tolerate malformed frames — the next snapshot will reconcile */
      }
    };
    source.addEventListener("activity", onActivity);
    source.addEventListener("run_update", onActivity);
    source.addEventListener("run_done", (evt) => {
      onActivity(evt);
      scheduleRefresh();
    });
    source.addEventListener("health", () => scheduleRefresh());
    source.addEventListener("kpi", () => scheduleRefresh());
    source.addEventListener("heartbeat", () => {
      if (cancelledRef.current) return;
      if (connection !== "open") setConnection("open");
    });
    source.addEventListener("error", () => {
      if (cancelledRef.current) return;
      // Browser EventSource auto-reconnects on its own; reflect the gap in UI.
      setConnection("error");
      setStreamError("实时流暂时中断 · 自动重连中");
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
      await pauseAllRuns("Cockpit 急停", `ui-${Date.now()}`);
      scheduleRefresh();
      setConfirmOpen(false);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setPauseBusy(false);
    }
  }, [scheduleRefresh]);

  const onResume = useCallback(async () => {
    try {
      await resumeAllRuns();
      scheduleRefresh();
    } catch (e) {
      setActionError(String(e));
    }
  }, [scheduleRefresh]);

  const onRetryConnection = useCallback(() => {
    // EventSource auto-reconnects; this forces an immediate /summary refetch
    // so the user gets feedback instead of a stuck "reconnecting" banner.
    setStreamError(null);
    setConnection("connecting");
    scheduleRefresh();
  }, [scheduleRefresh]);

  // loading = no snapshot yet AND the stream hasn't raised an error yet.
  // Keeps the three-state (loading / error / empty) branch explicit per P04.
  const isLoading = summary === null && connection !== "error";

  return (
    <AppShell title="驾驶舱">
      <div className="h-full overflow-y-auto">
        <div className="p-6 space-y-4">
          {actionError && (
            <ErrorState
              title="操作失败"
              detail={actionError}
              action={{ label: "关闭", onClick: () => setActionError(null) }}
            />
          )}
          {streamError && (
            <ErrorState
              title="实时连接中断"
              description={streamError}
              action={{ label: "立即重试", onClick: onRetryConnection }}
            />
          )}
          {summary?.paused && (
            <div className="rounded border border-warning/40 bg-warning/5 px-3 py-2 text-[12px] flex items-center justify-between">
              <span className="text-warning font-medium">
                全局已暂停 · {summary.paused_reason ?? "无说明"}
              </span>
              <button
                type="button"
                onClick={onResume}
                className="rounded border border-warning/40 px-2 py-0.5 font-mono text-[11px] text-warning hover:bg-warning/10 transition-colors duration-base"
              >
                恢复运行
              </button>
            </div>
          )}
          {isLoading ? (
            <LoadingState
              title="加载驾驶舱"
              description="正在建立实时连接 · 首帧快照应在 1 秒内到达"
            />
          ) : summary === null ? (
            <ErrorState
              title="驾驶舱加载失败"
              description="后端暂不可达 · 连接恢复后会自动加载"
              action={{ label: "重试", onClick: onRetryConnection }}
            />
          ) : isWorkspaceEmpty(summary) ? (
            <>
              <KpiBar summary={summary} />
              <EmptyState
                title="工作区还没有活动"
                description="创建第一个员工或触发一次对话后,活动流会实时出现在这里"
              />
            </>
          ) : (
            <>
              <KpiBar summary={summary} />
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] gap-4 min-h-[60vh]">
                <div className="rounded border border-border bg-surface flex flex-col min-h-[40vh]">
                  <ActivityFeed events={summary.recent_events} />
                </div>
                <div className="flex flex-col gap-4 min-w-0">
                  <div className="rounded border border-border bg-surface">
                    <ActiveRunsList runs={summary.active_runs} />
                  </div>
                  <div className="rounded border border-border bg-surface">
                    <RecentConvList conversations={summary.recent_conversations} />
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="rounded border border-border bg-surface">
                    <HealthPanel health={summary.health} />
                  </div>
                  <div className="rounded border border-border bg-surface">
                    <QuickActions
                      paused={summary.paused}
                      onPause={() => setConfirmOpen(true)}
                      onResume={onResume}
                    />
                  </div>
                  <div className="rounded border border-border bg-surface">
                    <BudgetSummary summary={summary} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="急停所有 run"
        message={
          "这会取消当前所有正在执行的 run,并暂停 trigger executor。" +
          "\n\n已在进行中的 tool call 可能无法回滚。只有在确实需要" +
          "刹停整个 workspace 时才继续。"
        }
        danger
        busy={pauseBusy}
        confirmLabel="确认急停"
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

/** Build an `ActivityEventDto` from a raw SSE frame payload. Returns `null`
 * if the shape is unrecognizable — the next snapshot will reconcile. */
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
