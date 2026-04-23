"use client";

/**
 * RunHeader · Brand Blue Dual Theme V2 (ADR 0016)
 *
 * Layout: rounded-xl card with shadow-soft-sm. Gradient circular avatar for
 * the employee + name + status chip (coloured by status) + duration + trace
 * chip. Underneath, a dense token/time metadata row.
 */

import type { RunDetailDto, RunStatusDto } from "@/lib/observatory-api";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";
import { TraceChip } from "./TraceChip";

type StatusVisual = {
  label: string;
  chipClass: string;
  dotClass: string;
  icon: IconName;
};

const STATUS: Record<RunStatusDto, StatusVisual> = {
  running: {
    label: "运行中",
    chipClass: "border-warning/30 bg-warning-soft text-warning",
    dotClass: "bg-warning animate-pulse-soft",
    icon: "loader",
  },
  succeeded: {
    label: "已完成",
    chipClass: "border-success/30 bg-success-soft text-success",
    dotClass: "bg-success",
    icon: "check-circle-2",
  },
  failed: {
    label: "失败",
    chipClass: "border-danger/30 bg-danger-soft text-danger",
    dotClass: "bg-danger",
    icon: "alert-circle",
  },
  cancelled: {
    label: "已取消",
    chipClass: "border-border bg-surface-2 text-text-muted",
    dotClass: "bg-text-muted",
    icon: "x",
  },
};

function formatDuration(s: number | null): string {
  if (s === null) return "—";
  if (s < 1) return `${Math.round(s * 1000)}ms`;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m ${r}s`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function initial(name: string | null | undefined): string {
  if (!name) return "·";
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : "·";
}

export function RunHeader({ run }: { run: RunDetailDto }) {
  const status = STATUS[run.status];
  const spin = run.status === "running";

  return (
    <header
      data-testid="run-header"
      className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-semibold text-primary-fg shadow-soft-sm"
        >
          {initial(run.employee_name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-text">
              {run.employee_name ?? "—"}
            </span>
            <span
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-full border px-2 font-mono text-[10px]",
                status.chipClass,
              )}
            >
              <span
                aria-hidden="true"
                className={cn("h-1.5 w-1.5 rounded-full", status.dotClass)}
              />
              <Icon
                name={status.icon}
                size={10}
                className={spin ? "animate-spin-slow" : undefined}
              />
              {status.label}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-text-subtle">
            <span className="truncate">{run.run_id}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-caption text-text-muted">
            <Icon name="clock" size={11} />
            {formatDuration(run.duration_s)}
          </span>
          <TraceChip runId={run.run_id} label={run.run_id.slice(0, 8)} />
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-caption sm:grid-cols-4">
        <div>
          <dt className="text-text-muted">员工</dt>
          <dd className="text-text">{run.employee_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-text-muted">耗时</dt>
          <dd className="font-mono text-text">{formatDuration(run.duration_s)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">tokens</dt>
          <dd className="font-mono text-text">{run.tokens.total || 0}</dd>
        </div>
        <div>
          <dt className="text-text-muted">开始</dt>
          <dd className="font-mono text-text">{formatTime(run.started_at)}</dd>
        </div>
      </dl>
    </header>
  );
}
