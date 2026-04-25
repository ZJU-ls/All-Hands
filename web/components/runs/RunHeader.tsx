"use client";

/**
 * RunHeader · Brand Blue Dual Theme V2 (ADR 0016)
 *
 * Layout: rounded-xl card with shadow-soft-sm. Gradient circular avatar for
 * the employee + name + status chip (coloured by status) + duration + trace
 * chip. Underneath, a dense token/time metadata row.
 */

import { useTranslations } from "next-intl";
import type { RunDetailDto, RunStatusDto } from "@/lib/observatory-api";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";
import { TraceChip } from "./TraceChip";

type StatusVisual = {
  chipClass: string;
  dotClass: string;
  icon: IconName;
};

const STATUS: Record<RunStatusDto, StatusVisual> = {
  running: {
    chipClass: "border-warning/30 bg-warning-soft text-warning",
    dotClass: "bg-warning animate-pulse-soft",
    icon: "loader",
  },
  succeeded: {
    chipClass: "border-success/30 bg-success-soft text-success",
    dotClass: "bg-success",
    icon: "check-circle-2",
  },
  failed: {
    chipClass: "border-danger/30 bg-danger-soft text-danger",
    dotClass: "bg-danger",
    icon: "alert-circle",
  },
  cancelled: {
    chipClass: "border-border bg-surface-2 text-text-muted",
    dotClass: "bg-text-muted",
    icon: "x",
  },
};

import { formatDuration as _fmtDur, formatTokens } from "@/lib/format";

function formatDuration(s: number | null): string {
  if (s === null) return "—";
  return _fmtDur(s * 1000);
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
  const t = useTranslations("runs.header");
  const status = STATUS[run.status];
  const spin = run.status === "running";
  const fallback = t("fallback");

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
              {run.employee_name ?? fallback}
            </span>
            <span
              className={cn(
                "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 font-mono text-[10px]",
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
              {t(`status.${run.status}`)}
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
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-caption sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <dt className="text-text-muted">{t("employee")}</dt>
          <dd className="text-text truncate">{run.employee_name ?? fallback}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t("model")}</dt>
          <dd className="font-mono text-text truncate" title={run.model_ref ?? undefined}>
            {run.model_ref ?? fallback}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{t("duration")}</dt>
          <dd className="font-mono text-text">{formatDuration(run.duration_s)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t("tokens")}</dt>
          {run.tokens.total > 0 ? (
            <dd className="font-mono text-text">
              {formatTokens(run.tokens.total)}
              <span className="ml-1 text-text-subtle text-[10px]">
                · in {formatTokens(run.tokens.prompt)} · out {formatTokens(run.tokens.completion)}
              </span>
            </dd>
          ) : (
            <dd className="font-mono text-text-subtle">{fallback}</dd>
          )}
        </div>
        <div>
          <dt className="text-text-muted">{t("startedAt")}</dt>
          <dd className="font-mono text-text">{formatTime(run.started_at)}</dd>
        </div>
      </dl>
    </header>
  );
}
