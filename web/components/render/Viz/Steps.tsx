"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { RenderProps } from "@/lib/component-registry";
import { Icon } from "@/components/ui/icon";

type Status = "pending" | "in_progress" | "done" | "failed";

type Step = {
  title: string;
  description?: string;
  status: Status;
};

const DOT_COLOR: Record<Status, string> = {
  pending: "bg-surface-3",
  in_progress: "bg-primary",
  done: "bg-success",
  failed: "bg-danger",
};
const DOT_RING: Record<Status, string> = {
  pending: "",
  in_progress: "animate-pulse-ring",
  done: "",
  failed: "",
};
const NUM_COLOR: Record<Status, string> = {
  pending: "text-text-subtle",
  in_progress: "text-primary",
  done: "text-success",
  failed: "text-danger",
};
const TITLE_COLOR: Record<Status, string> = {
  pending: "text-text-muted",
  in_progress: "text-text font-semibold",
  done: "text-text",
  failed: "text-danger font-semibold",
};
const CONNECTOR_COLOR: Record<Status, string> = {
  pending: "bg-border",
  in_progress: "bg-primary/40",
  done: "bg-success/40",
  failed: "bg-danger/40",
};

function normStepStatus(raw: unknown): Status {
  if (raw === "done" || raw === "complete" || raw === "completed") return "done";
  if (raw === "in_progress" || raw === "running" || raw === "active") return "in_progress";
  if (raw === "failed" || raw === "error") return "failed";
  return "pending";
}

/**
 * Brand-Blue V2 (ADR 0016) · vertical pipeline.
 *
 * Interactions (2026-04-25):
 *   - hide-completed toggle · folds done steps behind a count chip; the
 *     count is clickable to expand them inline so the user keeps the
 *     option to scrub history.
 *   - shows a small progress hint in the toolbar (n/total · % done).
 *
 * The toolbar only renders when there's at least one done step AND total
 * steps > 4 — otherwise it's noise on a 3-step pipeline.
 */
export function Steps({ props }: RenderProps) {
  const t = useTranslations("viz.steps");
  const stepsRaw = Array.isArray(props.steps) ? (props.steps as unknown[]) : [];
  const steps: Step[] = stepsRaw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      title: typeof s.title === "string" ? s.title : "",
      description: typeof s.description === "string" ? s.description : undefined,
      status: normStepStatus(s.status),
    }));

  const [hideDone, setHideDone] = useState(false);
  const [expandFold, setExpandFold] = useState(false);

  const doneCount = useMemo(() => steps.filter((s) => s.status === "done").length, [steps]);
  const total = steps.length;

  if (total === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-3 text-caption text-text-muted">
        {t("empty")}
      </div>
    );
  }

  const showToolbar = doneCount > 0 && total > 4;
  const pctDone = Math.round((doneCount / total) * 100);

  // When hiding done, find the index of the first non-done step. We render a
  // "fold" bar above it summarising the hidden completed steps.
  const firstActiveIdx = steps.findIndex((s) => s.status !== "done");

  return (
    <div className="rounded-xl border border-border bg-surface shadow-soft-sm animate-fade-up overflow-hidden">
      {showToolbar ? (
        <div className="flex items-center gap-2 border-b border-border bg-surface-2/40 px-3 py-2">
          <span className="text-caption font-mono text-text-muted tabular-nums">
            {t("progress", { done: doneCount, total, pct: pctDone })}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setHideDone((v) => !v);
                setExpandFold(false);
              }}
              aria-pressed={hideDone}
              title={hideDone ? t("showDone") : t("hideDone")}
              className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-caption transition-colors duration-fast ${
                hideDone
                  ? "border-primary/40 bg-primary-muted text-primary"
                  : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text"
              }`}
            >
              <Icon name={hideDone ? "eye-off" : "eye"} size={12} />
              {hideDone ? t("folded") : t("fold")}
            </button>
          </div>
        </div>
      ) : null}
      <ol className="px-4 py-3">
        {steps.map((step, i) => {
          const isLast = i === total - 1;
          const folded = hideDone && step.status === "done" && !expandFold;
          // Render the fold-bar in place of the first folded step block.
          if (folded && i !== 0 && hideDone && !expandFold) {
            // Render only at the position immediately before firstActiveIdx,
            // so we get a single fold bar instead of one per hidden step.
            if (i + 1 === firstActiveIdx || (firstActiveIdx === -1 && i === total - 1)) {
              return (
                <li key={`fold-${i}`} className="mb-2">
                  <button
                    type="button"
                    onClick={() => setExpandFold(true)}
                    className="block w-full rounded-md border border-dashed border-border bg-surface-2/30 px-3 py-2 text-left text-caption font-mono text-text-subtle transition-colors duration-fast hover:bg-surface-2 hover:text-text-muted"
                  >
                    {t("foldedSummary", { count: doneCount })}
                  </button>
                </li>
              );
            }
            return null;
          }
          // First folded step (i === 0) becomes a compact fold marker.
          if (folded && i === 0 && hideDone && !expandFold) {
            // Skip — the marker is rendered at the boundary just before
            // the first non-done step.
            if (firstActiveIdx > 0) return null;
          }
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
              <div className="min-w-0 flex-1 pb-4 last:pb-0">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-caption font-mono font-semibold tabular-nums uppercase tracking-wider ${NUM_COLOR[step.status]}`}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className={`break-words text-sm ${TITLE_COLOR[step.status]}`}>
                    {step.title}
                  </span>
                </div>
                {step.description && (
                  <p className="mt-1 break-words text-caption leading-relaxed text-text-muted">
                    {step.description}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
