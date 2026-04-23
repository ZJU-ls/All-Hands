"use client";

/**
 * PlanTimeline — chat-visible agent plan (agent-design § 5.3).
 *
 * V2-level (ADR 0016 · Brand-Blue Dual Theme). Vertical timeline with:
 * - Step dots: `bg-primary` (running · current) · `bg-success` (done) ·
 *   `bg-surface-3` (pending / upcoming) · `bg-text-subtle` (skipped) ·
 *   `bg-danger` (failed).
 * - A 1px connector line behind the dots (`bg-border`).
 * - Card shell `rounded-xl border bg-surface shadow-soft-sm`.
 *
 * Colors are from the token pack so dark / light both work without `dark:`
 * overrides.
 */

import { Icon, type IconName } from "@/components/ui/icon";
import type { RenderProps } from "@/lib/component-registry";

type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";

type PlanStep = {
  index: number;
  title: string;
  status: StepStatus;
  note?: string | null;
};

const STATUS_LABEL: Record<StepStatus, string> = {
  pending: "待办",
  running: "进行中",
  done: "已完成",
  skipped: "跳过",
  failed: "失败",
};

const DOT_CLASS: Record<StepStatus, string> = {
  pending: "bg-surface-3 border border-border",
  running: "bg-primary shadow-glow-sm animate-pulse-soft",
  done: "bg-success",
  skipped: "bg-text-subtle",
  failed: "bg-danger",
};

const DOT_ICON: Record<StepStatus, IconName | null> = {
  pending: null,
  running: null,
  done: "check",
  skipped: null,
  failed: "x",
};

const TITLE_CLASS: Record<StepStatus, string> = {
  pending: "text-text-muted",
  running: "text-text font-medium",
  done: "text-text-muted line-through",
  skipped: "text-text-subtle line-through",
  failed: "text-danger",
};

export function PlanTimeline({ props }: RenderProps) {
  const title = (props.title as string) ?? "计划";
  const steps = Array.isArray(props.steps)
    ? (props.steps as PlanStep[]).filter((s) => typeof s.index === "number")
    : [];
  const total = steps.length;
  const done = steps.filter((s) => s.status === "done").length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-soft-sm"
      data-testid="plan-timeline"
    >
      <div className="flex items-center gap-3 border-b border-border bg-surface-2/60 px-4 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-primary-muted text-primary">
          <Icon name="activity" size={14} strokeWidth={2} />
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-text">
          {title}
        </span>
        <span className="ml-auto font-mono text-[11px] text-text-subtle">
          {done} / {total}
        </span>
      </div>

      {total > 0 && (
        <div className="px-4 pt-3">
          <div className="h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-base ease-out"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}

      <ol className="relative px-4 py-4">
        {steps.length > 1 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[22px] top-6 bottom-6 w-px bg-border"
          />
        )}
        {steps.map((step) => {
          const icon = DOT_ICON[step.status];
          return (
            <li
              key={step.index}
              className="relative flex items-start gap-3 py-1.5 text-sm"
              data-testid={`plan-step-${step.index}`}
              data-status={step.status}
            >
              <span
                className={`relative z-10 mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full ${DOT_CLASS[step.status]}`}
                aria-label={STATUS_LABEL[step.status]}
              >
                {icon && (
                  <Icon
                    name={icon}
                    size={10}
                    strokeWidth={2.5}
                    className="text-primary-fg"
                  />
                )}
              </span>
              <span className="w-6 shrink-0 pt-0.5 font-mono text-[10px] text-text-subtle">
                {String(step.index + 1).padStart(2, "0")}
              </span>
              <span className={`flex-1 min-w-0 ${TITLE_CLASS[step.status]}`}>
                {step.title}
                {step.note && (
                  <span className="mt-0.5 block text-[11px] italic text-text-subtle">
                    {step.note}
                  </span>
                )}
              </span>
            </li>
          );
        })}
        {steps.length === 0 && (
          <li className="text-sm text-text-muted">(no steps)</li>
        )}
      </ol>
    </div>
  );
}
