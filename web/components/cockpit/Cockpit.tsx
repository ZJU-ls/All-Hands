"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  getCockpitSummary,
  pauseAllRuns,
  resumeAllRuns,
  type WorkspaceSummaryDto,
} from "@/lib/cockpit-api";
import { ActiveRunsList } from "./ActiveRunsList";
import { ActivityFeed } from "./ActivityFeed";
import { BudgetSummary } from "./BudgetSummary";
import { HealthPanel } from "./HealthPanel";
import { KpiBar } from "./KpiBar";
import { QuickActions } from "./QuickActions";
import { RecentConvList } from "./RecentConvList";

const POLL_MS = 5000;

export function Cockpit() {
  const [summary, setSummary] = useState<WorkspaceSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const s = await getCockpitSummary();
      if (cancelledRef.current) return;
      setSummary(s);
      setError(null);
    } catch (e) {
      if (cancelledRef.current) return;
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    const timer = setInterval(() => {
      void load();
    }, POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(timer);
    };
  }, [load]);

  const onPauseConfirm = useCallback(async () => {
    setPauseBusy(true);
    try {
      await pauseAllRuns("Cockpit 急停", `ui-${Date.now()}`);
      await load();
      setConfirmOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setPauseBusy(false);
    }
  }, [load]);

  const onResume = useCallback(async () => {
    try {
      await resumeAllRuns();
      await load();
    } catch (e) {
      setError(String(e));
    }
  }, [load]);

  return (
    <AppShell title="驾驶舱">
      <div className="h-full overflow-y-auto">
        <div className="p-6 space-y-4">
          {error && (
            <div className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">
              {error}
            </div>
          )}
          {summary?.paused && (
            <div className="rounded border border-warning/40 bg-warning/5 px-3 py-2 text-[12px] flex items-center justify-between">
              <span className="text-warning font-medium">
                ⚠ 全局已暂停 · {summary.paused_reason ?? "无说明"}
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
          {summary === null ? (
            <p className="text-[12px] text-text-muted">加载驾驶舱…</p>
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
          "\n\n已在进行中的 tool call 可能无法回滚。只有在确实需要"
          + "刹停整个 workspace 时才继续。"
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
