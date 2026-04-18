"use client";

import type { RenderProps } from "@/lib/component-registry";

/**
 * PlanTimeline — chat-visible agent plan (agent-design § 5.3).
 *
 * Consumes the payload from the `plan_view` meta tool:
 *
 *   { title: string, steps: Array<{ index, title, status, note? }> }
 *
 * Five statuses map to a 1-char glyph rendered in mono; colors use semantic
 * tokens only (no hex, no Tailwind raw colors) per CLAUDE.md §3.5.
 */

type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";

type PlanStep = {
  index: number;
  title: string;
  status: StepStatus;
  note?: string | null;
};

const STATUS_GLYPH: Record<StepStatus, string> = {
  pending: "·",
  running: "→",
  done: "✓",
  skipped: "↷",
  failed: "✗",
};

const STATUS_LABEL: Record<StepStatus, string> = {
  pending: "待办",
  running: "进行中",
  done: "已完成",
  skipped: "跳过",
  failed: "失败",
};

const STATUS_CLASSES: Record<StepStatus, string> = {
  pending: "text-text-muted",
  running: "text-primary",
  done: "text-text",
  skipped: "text-text-muted",
  failed: "text-danger",
};

export function PlanTimeline({ props }: RenderProps) {
  const title = (props.title as string) ?? "计划";
  const steps = Array.isArray(props.steps)
    ? (props.steps as PlanStep[]).filter((s) => typeof s.index === "number")
    : [];
  const total = steps.length;
  const done = steps.filter((s) => s.status === "done").length;

  return (
    <div
      className="rounded-lg border border-border bg-bg overflow-hidden"
      data-testid="plan-timeline"
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-xs font-semibold text-text">{title}</span>
        <span className="text-xs text-text-muted font-mono">
          {done} / {total}
        </span>
      </div>
      <ol className="px-4 py-3 space-y-1.5">
        {steps.map((step) => (
          <li
            key={step.index}
            className="flex items-start gap-2 text-sm"
            data-testid={`plan-step-${step.index}`}
            data-status={step.status}
          >
            <span
              className={`font-mono w-4 shrink-0 text-center ${STATUS_CLASSES[step.status]}`}
              aria-label={STATUS_LABEL[step.status]}
            >
              {STATUS_GLYPH[step.status]}
            </span>
            <span className="font-mono text-xs text-text-muted w-5 shrink-0">
              {String(step.index + 1).padStart(2, "0")}
            </span>
            <span
              className={`flex-1 ${
                step.status === "done" || step.status === "skipped"
                  ? "text-text-muted line-through"
                  : "text-text"
              }`}
            >
              {step.title}
              {step.note && (
                <span className="block text-xs text-text-muted italic mt-0.5">
                  {step.note}
                </span>
              )}
            </span>
          </li>
        ))}
        {steps.length === 0 && (
          <li className="text-sm text-text-muted">(no steps)</li>
        )}
      </ol>
    </div>
  );
}
