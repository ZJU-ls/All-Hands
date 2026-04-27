"use client";

/**
 * PlanProgressSection · ADR 0019 C1
 *
 * Two render modes:
 *   - default (`embedded={false}`): standalone collapsible card with own
 *     header + chevron toggle, used when not nested in a tab strip.
 *   - embedded (`embedded={true}`): no header / always expanded — caller
 *     (ProgressPanel tab body) owns the chrome and the open/close state.
 *
 * The step list itself is identical in both modes:
 *   - running step bg highlight + activeForm text (s.note)
 *   - done step strike-through with content text (s.title)
 *   - pending step muted ring with content text
 *
 * Status mapping is per ADR 0019 C1 Round 1:
 *   pending → PENDING (gray ring)
 *   running → RUNNING (warning, pulse)
 *   done    → DONE (success, check)
 *   failed  → FAILED (danger, x)
 *   skipped → SKIPPED (subtle dot)
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { PlanLatestDto, PlanStepStatus } from "@/lib/api";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

const STORAGE_KEY = "allhands.progress.plan.expanded";

type Props = { plan: PlanLatestDto; embedded?: boolean };

export function PlanProgressSection({ plan, embedded = false }: Props) {
  const t = useTranslations("chat.planProgress");
  const [expanded, setExpanded] = useState<boolean>(true);

  // Persisted toggle state — only relevant in standalone (non-embedded)
  // mode. Embedded mode is always expanded since the parent tab strip
  // already owns the show/hide.
  useEffect(() => {
    if (embedded) return;
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      if (v === "false") setExpanded(false);
    } catch {
      /* private-browsing fallback: default expanded */
    }
  }, [embedded]);

  const toggle = () => {
    if (embedded) return;
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const done = plan.steps.filter((s) => s.status === "done").length;
  const running = plan.steps.filter((s) => s.status === "running").length;
  const failed = plan.steps.filter((s) => s.status === "failed").length;
  const total = plan.steps.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const stepList = (
    <div
      className={cn(
        "space-y-px px-2 pb-2",
        embedded ? "pt-2" : "border-t border-border bg-surface pt-1.5 pb-1.5",
      )}
    >
      {plan.steps.map((s) => {
        // ADR 0019 C1 Round 1: backend stashes Claude-Code style
        // activeForm into PlanStep.note. Running rows show activeForm
        // ("Reading code"), pending / completed rows show content
        // ("Read code") — the spinner/imperative dichotomy.
        const isRunning = s.status === "running";
        const display = isRunning && s.note ? s.note : s.title;
        return (
          <div
            key={s.index}
            data-testid={`plan-step-${s.index}`}
            data-status={s.status}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-[background-color,color]",
              isRunning ? "bg-warning-soft/40" : "hover:bg-surface-2",
            )}
          >
            <span className="w-5 shrink-0 text-right font-mono text-[10px] text-text-subtle">
              {s.index + 1}
            </span>
            <StepDot status={s.status} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] leading-snug",
                s.status === "done"
                  ? "text-text-subtle line-through decoration-text-subtle/40"
                  : isRunning
                    ? "font-medium text-text"
                    : s.status === "failed"
                      ? "text-danger"
                      : "text-text-muted",
              )}
              title={s.note ? `${s.title} · ${s.note}` : s.title}
            >
              {display}
            </span>
          </div>
        );
      })}
    </div>
  );

  // Embedded mode: just the step list, no chrome.
  if (embedded) {
    return (
      <div data-testid="plan-progress-section" data-embedded="true">
        {stepList}
      </div>
    );
  }

  // Standalone mode: include header + toggle.
  return (
    <div
      data-testid="plan-progress-section"
      className="border-b border-border last:border-b-0"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-[background-color,color] duration-fast hover:bg-surface-3"
      >
        <Icon
          name={expanded ? "chevron-down" : "chevron-right"}
          size={11}
          className="shrink-0 text-text-subtle transition-[background-color,color] group-hover:text-text-muted"
        />
        <span
          aria-hidden="true"
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-primary-muted text-primary"
        >
          <Icon name="list" size={11} />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text"
          title={plan.title}
        >
          {plan.title}
        </span>
        <div
          aria-hidden="true"
          className="hidden h-1 w-24 shrink-0 overflow-hidden rounded-full bg-surface sm:block"
        >
          <div
            className={cn(
              "h-full transition-[width] duration-fast",
              failed > 0
                ? "bg-danger"
                : running > 0
                  ? "bg-warning"
                  : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[11px] text-text-muted">
          <span className="tabular-nums">{done}</span>
          <span className="text-text-subtle">/{total}</span>
          {running > 0 && (
            <span className="ml-1.5 text-warning">{t("runningCount", { n: running })}</span>
          )}
          {failed > 0 && (
            <span className="ml-1.5 text-danger">{t("failedCount", { n: failed })}</span>
          )}
        </span>
      </button>
      {expanded && stepList}
    </div>
  );
}

function StepDot({ status }: { status: PlanStepStatus }) {
  const tStep = useTranslations("chat.planProgress.step");
  const base =
    "relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border";
  if (status === "done") {
    return (
      <span
        aria-label={tStep("done")}
        className={cn(base, "border-success bg-success text-white")}
      >
        <Icon name="check" size={8} strokeWidth={3} />
      </span>
    );
  }
  if (status === "running") {
    return (
      <span
        aria-label={tStep("running")}
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
        aria-label={tStep("failed")}
        className={cn(base, "border-danger bg-danger text-white")}
      >
        <Icon name="x" size={8} strokeWidth={3} />
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span
        aria-label={tStep("skipped")}
        className={cn(base, "border-text-subtle bg-surface-3 text-text-subtle")}
      >
        <span className="block h-1 w-1 rounded-full bg-text-subtle" />
      </span>
    );
  }
  return (
    <span
      aria-label={tStep("pending")}
      className={cn(base, "border-border bg-surface-3")}
    />
  );
}
