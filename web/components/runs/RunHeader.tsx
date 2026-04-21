"use client";

import type { RunDetailDto, RunStatusDto } from "@/lib/observatory-api";
import { cn } from "@/lib/cn";

const STATUS_DOT: Record<RunStatusDto, string> = {
  running: "bg-warning",
  succeeded: "bg-success",
  failed: "bg-danger",
  cancelled: "bg-text-muted",
};

const STATUS_LABEL: Record<RunStatusDto, string> = {
  running: "运行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
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

export function RunHeader({ run }: { run: RunDetailDto }) {
  return (
    <header
      data-testid="run-header"
      className="rounded-md border border-border bg-surface px-4 py-3 space-y-2"
    >
      <div className="flex items-center gap-2 text-[12px]">
        <span
          aria-label={STATUS_LABEL[run.status]}
          className={cn("h-2 w-2 rounded-full", STATUS_DOT[run.status])}
        />
        <span className="text-text font-medium">{STATUS_LABEL[run.status]}</span>
        <span className="text-text-subtle font-mono text-[10px]">·</span>
        <span className="font-mono text-[10px] text-text-muted truncate">
          {run.run_id}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
        <div>
          <dt className="text-text-muted">员工</dt>
          <dd className="text-text">{run.employee_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-text-muted">耗时</dt>
          <dd className="text-text font-mono">{formatDuration(run.duration_s)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">tokens</dt>
          <dd className="text-text font-mono">{run.tokens.total || 0}</dd>
        </div>
        <div>
          <dt className="text-text-muted">开始</dt>
          <dd className="text-text font-mono">{formatTime(run.started_at)}</dd>
        </div>
      </dl>
    </header>
  );
}
