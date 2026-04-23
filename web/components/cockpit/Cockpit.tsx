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
 * Layout: HUD strip → KPI console → 2-column main (activity | runs) with
 * a 44px right-edge DrawerRail hosting secondary observation panels
 * (Health · Budget · Convs). Runtime ops (急停 / resume / refresh) are
 * always visible on the HUD's right cluster.
 *
 * Visual language: Linear Precise + allowed decorative primitives only
 * (Sparkline · DotGridBackdrop · Hairline accent · status dots · mono
 * typography). No glow, no scale, no drop-shadow, no third-party icons.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
      let msg = "实时流终止";
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
    setStreamError(null);
    setConnection("connecting");
    scheduleRefresh();
  }, [scheduleRefresh]);

  const isLoading = summary === null && connection !== "error";

  return (
    <AppShell title="驾驶舱">
      <div className="relative h-full flex overflow-hidden">
        {/* Decorative dot-grid anchor, fixed, ≤ 25% opacity per §3.8 allowed */}
        <DotGridBackdrop opacity={0.22} fade={false} />

        <div className="relative flex-1 min-w-0 overflow-y-auto">
          <div className="p-6 space-y-4 min-h-full flex flex-col">
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
            {isLoading ? (
              <LoadingState
                title="装载驾驶舱"
                description="建立实时连接 · 首帧快照应在 1 秒内到达"
              />
            ) : summary === null ? (
              <ErrorState
                title="驾驶舱加载失败"
                description="后端暂不可达 · 连接恢复后会自动加载"
                action={{ label: "重试", onClick: onRetryConnection }}
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
                  <div className="relative flex-1 flex items-center justify-center rounded-md border border-border bg-surface px-6 py-12 overflow-hidden min-h-[50vh]">
                    <DotGridBackdrop opacity={0.3} />
                    <div className="relative mx-auto max-w-md">
                      <EmptyState
                        title="系统待命 · 零活动"
                        description="发起一次对话或触发任务,飞行记录会实时出现在这里"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <Coachmark
                      id="cockpit-activity"
                      title="飞行记录 · 实时"
                      description="tool 调用、run 状态变化按时间倒序排。序号 001 是最近一条,点事件跳到对应 trace。右侧 rail 的健康 / 消耗 / 对话抽屉提供次级观测。"
                    />
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 flex-1 min-h-[55vh]">
                      <div className="rounded border border-border bg-surface flex flex-col min-h-[40vh]">
                        <ActivityFeed events={summary.recent_events} />
                      </div>
                      <div className="rounded border border-border bg-surface flex flex-col min-h-[40vh]">
                        <ActiveRunsList runs={summary.active_runs} />
                      </div>
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
