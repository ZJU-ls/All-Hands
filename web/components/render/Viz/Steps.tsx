"use client";

import type { RenderProps } from "@/lib/component-registry";

type Step = {
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "done" | "failed";
};

const DOT_COLOR: Record<Step["status"], string> = {
  pending: "bg-text-subtle",
  in_progress: "bg-primary",
  done: "bg-success",
  failed: "bg-danger",
};

const CONNECTOR_COLOR: Record<Step["status"], string> = {
  pending: "bg-border",
  in_progress: "bg-primary/60",
  done: "bg-success/60",
  failed: "bg-danger/60",
};

export function Steps({ props }: RenderProps) {
  const steps = (props.steps as Step[] | undefined) ?? [];

  return (
    <ol className="rounded-lg border border-border bg-bg px-4 py-3">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center pt-1">
              <span
                className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${DOT_COLOR[step.status]}`}
                aria-label={step.status}
              />
              {!isLast && (
                <span
                  className={`w-px flex-1 mt-1 min-h-[16px] ${CONNECTOR_COLOR[step.status]}`}
                  aria-hidden
                />
              )}
            </div>
            <div className="flex-1 pb-4 last:pb-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-mono text-text-muted">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-sm font-semibold text-text">
                  {step.title}
                </span>
              </div>
              {step.description && (
                <p className="text-xs text-text-muted mt-1 leading-relaxed">
                  {step.description}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
