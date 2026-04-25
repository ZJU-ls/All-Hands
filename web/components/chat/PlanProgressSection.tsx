"use client";

/**
 * PlanProgressSection · ADR 0019 C1
 *
 * Collapsible section showing the conversation's latest plan as a
 * compact step list. Header always shows status summary (N/M · K
 * running) so users get the gist even when collapsed. Expand state
 * persists across conversations via localStorage.
 */

import { useEffect, useState } from "react";
import type { PlanLatestDto, PlanStepStatus } from "@/lib/api";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

const STORAGE_KEY = "allhands.progress.plan.expanded";

type Props = { plan: PlanLatestDto };

export function PlanProgressSection({ plan }: Props) {
  const [expanded, setExpanded] = useState<boolean>(true);

  // Load persisted state on mount; default true.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      if (v === "false") setExpanded(false);
    } catch {
      // Reading localStorage can throw in some private-browsing modes;
      // fall through with default expanded=true.
    }
  }, []);

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore — UX is just persistence, not correctness
      }
      return next;
    });
  };

  const done = plan.steps.filter((s) => s.status === "done").length;
  const running = plan.steps.filter((s) => s.status === "running").length;
  const total = plan.steps.length;

  return (
    <div
      data-testid="plan-progress-section"
      className="border-b border-border last:border-b-0"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-fast hover:bg-surface-2"
      >
        <Icon
          name={expanded ? "chevron-down" : "chevron-right"}
          size={11}
          className="shrink-0 text-text-subtle"
        />
        <span
          aria-hidden="true"
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-success-soft text-success"
        >
          <Icon name="list" size={11} />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text"
          title={plan.title}
        >
          {plan.title}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-text-muted">
          {done}/{total}
          {running > 0 && (
            <span className="ml-1.5 text-warning">· {running} 进行中</span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="space-y-0.5 px-3 pb-2 pt-0.5">
          {plan.steps.map((s) => (
            <div
              key={s.index}
              data-testid={`plan-step-${s.index}`}
              data-status={s.status}
              className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2"
            >
              <span className="w-5 shrink-0 font-mono text-[10px] text-text-subtle">
                {String(s.index + 1).padStart(2, "0")}
              </span>
              <StepDot status={s.status} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[12px]",
                  s.status === "done"
                    ? "text-text-subtle line-through"
                    : "text-text",
                )}
                title={s.note ? `${s.title} · ${s.note}` : s.title}
              >
                {s.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StepDot({ status }: { status: PlanStepStatus }) {
  const base =
    "relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border";
  if (status === "done") {
    return (
      <span
        aria-label="done"
        className={cn(base, "border-success bg-success text-white")}
      >
        <Icon name="check" size={8} strokeWidth={3} />
      </span>
    );
  }
  if (status === "running") {
    return (
      <span
        aria-label="running"
        className={cn(
          base,
          "border-warning bg-warning shadow-[0_0_0_3px_rgba(251,191,36,0.18)] animate-pulse",
        )}
      />
    );
  }
  if (status === "failed") {
    return (
      <span
        aria-label="failed"
        className={cn(base, "border-danger bg-danger text-white")}
      >
        <Icon name="x" size={8} strokeWidth={3} />
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span
        aria-label="skipped"
        className={cn(base, "border-text-subtle bg-surface-3 text-text-subtle")}
      >
        <span className="block h-1 w-1 rounded-full bg-text-subtle" />
      </span>
    );
  }
  // pending
  return (
    <span
      aria-label="pending"
      className={cn(base, "border-border bg-surface-3")}
    />
  );
}
