"use client";

/**
 * HUD · Cockpit top status strip ("mission-control" ticker).
 *
 * Always-on 32px strip that pins the runtime state (live/paused connection,
 * wall-clock, event rate, pending-user badges) above the console. Critical
 * runtime ops (global pause / resume / refresh) live at the right end so
 * the user can act without scrolling. This is the "observe + control" half
 * of the cockpit — definition-class flows (new employee / new skill / new
 * trigger) are deliberately absent per product direction.
 *
 * Visual language is within §3.8 hard discipline: no glow, no scale, no
 * third-party icon; only mono text + status dots (`ah-dot` keyframe) and
 * a micro Sparkline of event arrival rate.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sparkline } from "@/components/ui/Sparkline";
import type { ActivityEventDto, WorkspaceSummaryDto } from "@/lib/cockpit-api";

type Connection = "connecting" | "open" | "error";

function WallClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) {
    return (
      <span className="font-mono text-[11px] tabular-nums text-text-subtle">
        --:--:--
      </span>
    );
  }
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return (
    <span
      className="font-mono text-[11px] tabular-nums text-text-muted"
      aria-label="workspace time"
    >
      {hh}:{mm}:<span className="text-text">{ss}</span>
    </span>
  );
}

function StatusDot({
  kind,
  label,
}: {
  kind: "live" | "paused" | "reconnecting" | "offline";
  label: string;
}) {
  const dotColor =
    kind === "live"
      ? "bg-success"
      : kind === "paused"
        ? "bg-warning"
        : kind === "reconnecting"
          ? "bg-warning"
          : "bg-danger";
  const textColor =
    kind === "live"
      ? "text-success"
      : kind === "paused"
        ? "text-warning"
        : kind === "reconnecting"
          ? "text-warning"
          : "text-danger";
  const pulse = kind === "live" || kind === "reconnecting";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${dotColor}`}
        style={
          pulse
            ? { animation: "ah-dot 1800ms ease-in-out infinite" }
            : undefined
        }
      />
      <span
        className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${textColor}`}
      >
        {label}
      </span>
    </span>
  );
}

/** Bucket the last 5 minutes of events into 1-minute cells. Returns
 * 5 normalised values (oldest → newest) suitable for Sparkline input. */
function eventRateBuckets(
  events: ActivityEventDto[],
  now: Date = new Date(),
): { values: number[]; total: number; windowMs: number } {
  const WINDOW_MS = 5 * 60 * 1000;
  const BUCKET_MS = 60 * 1000;
  const BUCKETS = Math.floor(WINDOW_MS / BUCKET_MS);
  const counts = new Array<number>(BUCKETS).fill(0);
  const cutoff = now.getTime() - WINDOW_MS;
  let total = 0;
  for (const e of events) {
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t) || t < cutoff || t > now.getTime()) continue;
    const ageMs = now.getTime() - t;
    const idx = BUCKETS - 1 - Math.floor(ageMs / BUCKET_MS);
    if (idx >= 0 && idx < BUCKETS) {
      counts[idx] = (counts[idx] ?? 0) + 1;
      total += 1;
    }
  }
  const max = Math.max(1, ...counts);
  const values = counts.map((c) => c / max);
  return { values, total, windowMs: WINDOW_MS };
}

export function HUD({
  summary,
  connection,
  onPauseRequest,
  onResume,
  onRefresh,
}: {
  summary: WorkspaceSummaryDto;
  connection: Connection;
  onPauseRequest: () => void;
  onResume: () => void;
  onRefresh: () => void;
}) {
  // Recompute buckets on every render — cheap (≤50 events × constant work).
  // Re-renders happen on snapshot/activity updates, not on the 1s ticker
  // (ticker only touches WallClock's internal state).
  const rate = eventRateBuckets(summary.recent_events);

  const [statusKind, statusLabel]: [
    "live" | "paused" | "reconnecting" | "offline",
    string,
  ] = summary.paused
    ? ["paused", "已暂停"]
    : connection === "open"
      ? ["live", "LIVE"]
      : connection === "connecting"
        ? ["reconnecting", "连接中"]
        : ["offline", "离线"];

  return (
    <div
      className="relative flex items-center justify-between gap-4 h-8 px-3 rounded border border-border bg-surface overflow-hidden"
      data-testid="cockpit-hud"
    >
      {/* Left cluster: status · wall-clock */}
      <div className="flex items-center gap-3 min-w-0">
        <StatusDot kind={statusKind} label={statusLabel} />
        <span
          aria-hidden="true"
          className="h-3 w-px bg-border"
        />
        <WallClock />
        {summary.paused && summary.paused_reason && (
          <span className="font-mono text-[10px] text-text-subtle truncate max-w-[280px]">
            · {summary.paused_reason}
          </span>
        )}
      </div>

      {/* Middle cluster: event rate · badges */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="hidden sm:flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            EV/5M
          </span>
          <span
            className="font-mono text-[11px] tabular-nums text-text"
            data-testid="hud-event-total"
          >
            {rate.total}
          </span>
          <div className="w-16 text-primary">
            <Sparkline
              values={rate.values}
              height={16}
              strokeWidth={1.25}
              showEndpoint={rate.total > 0}
              ariaLabel={`${rate.total} events in last 5 minutes`}
            />
          </div>
        </div>
        {summary.tasks_needs_user > 0 && (
          <Link
            href="/tasks?filter=needs_user"
            className="group inline-flex items-center gap-1.5 h-6 px-2 rounded border border-warning/40 bg-warning/5 hover:bg-warning/10 transition-colors duration-base"
            aria-label={`${summary.tasks_needs_user} 个任务等你处理`}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-warning"
            />
            <span className="font-mono text-[10px] text-warning tabular-nums">
              {summary.tasks_needs_user} 等你处理
            </span>
          </Link>
        )}
        {summary.confirmations_pending > 0 && (
          <Link
            href="/confirmations"
            className="group inline-flex items-center gap-1.5 h-6 px-2 rounded border border-warning/40 bg-warning/5 hover:bg-warning/10 transition-colors duration-base"
            aria-label={`${summary.confirmations_pending} 个待确认 tool call`}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-warning"
            />
            <span className="font-mono text-[10px] text-warning tabular-nums">
              {summary.confirmations_pending} 待确认
            </span>
          </Link>
        )}
      </div>

      {/* Right cluster: runtime ops */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1 h-6 px-2 rounded border border-border text-text-muted hover:text-text hover:border-border-strong hover:bg-surface-2 transition-colors duration-base"
          title="立即刷新快照"
          aria-label="刷新"
          data-testid="hud-refresh"
        >
          <span aria-hidden="true" className="font-mono text-[11px] leading-none">
            ↻
          </span>
          <span className="hidden md:inline font-mono text-[10px] uppercase tracking-wider">
            REFRESH
          </span>
        </button>
        {summary.paused ? (
          <button
            type="button"
            onClick={onResume}
            className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded border border-warning/40 bg-warning/5 hover:bg-warning/10 text-warning transition-colors duration-base"
            data-testid="hud-resume"
          >
            <span aria-hidden="true" className="font-mono text-[11px] leading-none">
              ▶
            </span>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">
              恢复运行
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onPauseRequest}
            className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded border border-danger/40 bg-danger/5 hover:bg-danger/10 text-danger transition-colors duration-base"
            data-testid="hud-pause"
            aria-label="急停所有 run"
          >
            <span aria-hidden="true" className="font-mono text-[11px] leading-none">
              ■
            </span>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">
              急停
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
