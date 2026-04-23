"use client";

import type { RenderProps } from "@/lib/component-registry";

type Step = {
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "done" | "failed";
};

const DOT_COLOR: Record<Step["status"], string> = {
  pending: "bg-surface-3",
  in_progress: "bg-primary",
  done: "bg-success",
  failed: "bg-danger",
};

const DOT_RING: Record<Step["status"], string> = {
  pending: "",
  // pulse-ring animates primary-muted outward for active step — ADR 0016 D3
  in_progress: "animate-pulse-ring",
  done: "",
  failed: "",
};

const NUM_COLOR: Record<Step["status"], string> = {
  pending: "text-text-subtle",
  in_progress: "text-primary",
  done: "text-success",
  failed: "text-danger",
};

const TITLE_COLOR: Record<Step["status"], string> = {
  pending: "text-text-muted",
  in_progress: "text-text font-semibold",
  done: "text-text",
  failed: "text-danger font-semibold",
};

const CONNECTOR_COLOR: Record<Step["status"], string> = {
  pending: "bg-border",
  in_progress: "bg-primary/40",
  done: "bg-success/40",
  failed: "bg-danger/40",
};

function normStepStatus(raw: unknown): Step["status"] {
  if (raw === "done" || raw === "complete" || raw === "completed") return "done";
  if (raw === "in_progress" || raw === "running" || raw === "active") return "in_progress";
  if (raw === "failed" || raw === "error") return "failed";
  return "pending";
}

/**
 * Brand-Blue V2 (ADR 0016) · vertical pipeline.
 *
 * Shell: rounded-xl · shadow-soft-sm. Connector line bg-border. Step dots:
 * primary (current · animate-pulse-ring) · success (done) · danger (failed)
 * · surface-3 (upcoming).
 */
export function Steps({ props }: RenderProps) {
  const stepsRaw = Array.isArray(props.steps) ? (props.steps as unknown[]) : [];
  const steps: Step[] = stepsRaw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      title: typeof s.title === "string" ? s.title : "",
      description: typeof s.description === "string" ? s.description : undefined,
      status: normStepStatus(s.status),
    }));

  if (steps.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-3 text-caption text-text-muted">
        No steps
      </div>
    );
  }

  return (
    <ol className="rounded-xl border border-border bg-surface px-4 py-3 shadow-soft-sm animate-fade-up">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center pt-1">
              <span
                className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${DOT_COLOR[step.status]} ${DOT_RING[step.status]}`}
                aria-label={step.status}
              />
              {!isLast && (
                <span
                  className={`w-px flex-1 mt-1 min-h-[16px] ${CONNECTOR_COLOR[step.status]}`}
                  aria-hidden
                />
              )}
            </div>
            <div className="flex-1 pb-4 last:pb-0 min-w-0">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-caption font-mono font-semibold tabular-nums uppercase tracking-wider ${NUM_COLOR[step.status]}`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={`text-sm break-words ${TITLE_COLOR[step.status]}`}>
                  {step.title}
                </span>
              </div>
              {step.description && (
                <p className="text-caption text-text-muted mt-1 leading-relaxed break-words">
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
