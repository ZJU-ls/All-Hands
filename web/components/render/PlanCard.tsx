"use client";

import type { RenderInteraction, RenderProps } from "@/lib/component-registry";

/**
 * PlanCard · awaits-human-approval render target for render_plan (I-0022 Phase 3).
 *
 * Consumes the payload shape defined in backend allhands/api/protocol.py
 * `PlanCardProps` and mirrored in web/lib/protocol.ts. Separate from
 * `PlanTimeline` — that card is an internal progress memo; PlanCard is the
 * user-facing contract that gates side-effecting work on explicit approval.
 *
 * Visual contract (product/03-visual-design.md · design-system/MASTER.md):
 * - Linear Precise: bg-surface / border-border · color density ≤ 3 + semantic
 * - No icon library. Status uses 1-char mono glyphs (· ✓ ✗) per CLAUDE.md §3.5
 * - Approve / Reject / Edit buttons come from `interactions[]` so the host
 *   renderer routes the action (invoke_tool · send_message). PlanCard itself
 *   only draws the ghost buttons and hides them once any status is terminal.
 */

type StepStatus = "pending" | "approved" | "rejected";

type PlanCardStep = {
  id: string;
  title: string;
  body?: string;
  status: StepStatus;
};

type PlanCardPayload = {
  plan_id: string;
  title: string;
  steps: PlanCardStep[];
};

const STATUS_GLYPH: Record<StepStatus, string> = {
  pending: "·",
  approved: "✓",
  rejected: "✗",
};

const STATUS_CLASS: Record<StepStatus, string> = {
  pending: "text-text-muted",
  approved: "text-primary",
  rejected: "text-danger",
};

const STATUS_LABEL_ZH: Record<StepStatus, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已驳回",
};

function cardStatus(steps: PlanCardStep[]): StepStatus {
  if (steps.some((s) => s.status === "rejected")) return "rejected";
  if (steps.length > 0 && steps.every((s) => s.status === "approved")) return "approved";
  return "pending";
}

export function PlanCard({ props, interactions }: RenderProps) {
  const p = props as Partial<PlanCardPayload>;
  const planId = typeof p.plan_id === "string" ? p.plan_id : "";
  const title = typeof p.title === "string" && p.title ? p.title : "(未命名计划)";
  const steps = Array.isArray(p.steps)
    ? (p.steps as PlanCardStep[]).filter((s) => typeof s.id === "string")
    : [];
  const status = cardStatus(steps);
  const showButtons = status === "pending";
  const buttons: RenderInteraction[] = showButtons ? interactions : [];

  return (
    <article
      data-component="PlanCard"
      data-plan-id={planId}
      data-status={status}
      className={`relative rounded-md border px-4 py-4 ${
        // ADR 0013 · impeccable BAN 1 replaces the side-stripe with a
        // full-surface tint when the card is in pending state. Approved /
        // rejected render plain-surface so the user's eye doesn't keep
        // being pulled back to a resolved plan.
        status === "pending"
          ? "border-primary/30 bg-primary-soft"
          : "border-border bg-surface"
      }`}
    >

      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold tracking-tight text-text truncate">
            {title}
          </h3>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            <span aria-hidden="true" className={STATUS_CLASS[status]}>
              ·
            </span>
            <span className="ml-1">{STATUS_LABEL_ZH[status]}</span>
            {planId && <span className="ml-2 text-text-subtle">{planId}</span>}
          </p>
        </div>
      </header>

      <ol className="mt-3 space-y-2">
        {steps.map((step, idx) => (
          <li
            key={step.id}
            data-step-id={step.id}
            data-status={step.status}
            className="flex gap-2 text-[12px] leading-5"
          >
            <span
              aria-label={STATUS_LABEL_ZH[step.status]}
              className={`font-mono w-4 shrink-0 text-center ${STATUS_CLASS[step.status]}`}
            >
              {STATUS_GLYPH[step.status]}
            </span>
            <span className="font-mono text-[10px] text-text-subtle w-5 shrink-0 pt-0.5">
              {String(idx + 1).padStart(2, "0")}
            </span>
            <span className="flex-1 min-w-0">
              <span
                className={
                  step.status === "rejected"
                    ? "text-text-muted line-through"
                    : "text-text"
                }
              >
                {step.title}
              </span>
              {step.body && (
                <span className="block text-[11px] text-text-muted mt-0.5 whitespace-pre-wrap">
                  {step.body}
                </span>
              )}
            </span>
          </li>
        ))}
        {steps.length === 0 && (
          <li className="text-[12px] text-text-muted">(no steps)</li>
        )}
      </ol>

      {buttons.length > 0 && (
        <footer className="mt-4 flex items-center gap-2">
          {buttons.map((b) => (
            <button
              key={`${b.label}-${b.action}`}
              type="button"
              data-interaction-label={b.label}
              data-interaction-action={b.action}
              className="px-2.5 py-1 text-[11px] font-mono rounded border border-border bg-bg text-text hover:border-primary transition-[border-color] duration-[var(--dur-fast)]"
            >
              {b.label}
            </button>
          ))}
        </footer>
      )}
    </article>
  );
}
