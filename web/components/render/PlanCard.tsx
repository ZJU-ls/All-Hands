"use client";

/**
 * PlanCard · awaits-human-approval render target for render_plan
 * (I-0022 Phase 3) · V2-level (ADR 0016 · Brand-Blue Dual Theme).
 *
 * Layout: `rounded-xl border bg-surface shadow-soft-sm` shell · header with
 * gradient icon tile + title + status chip + plan id · steps list with
 * glyph/status dot · compact progress bar · Approve / Reject / Edit footer
 * from `interactions[]`.
 *
 * Contract preserved:
 * - `data-component`, `data-plan-id`, `data-status`, per-step `data-status`
 * - pending-only footer buttons
 * - copy / payloads untouched so the existing test suite keeps passing.
 */

import { Icon, type IconName } from "@/components/ui/icon";
import type { RenderInteraction, RenderProps } from "@/lib/component-registry";

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

const STATUS_LABEL_ZH: Record<StepStatus, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已驳回",
};

const STEP_ICON: Record<StepStatus, IconName> = {
  pending: "clock",
  approved: "check",
  rejected: "x",
};

const CARD_STATUS_STYLE: Record<StepStatus, { chip: string; iconTile: string }> = {
  pending: {
    chip: "bg-primary-muted text-primary",
    iconTile: "bg-primary-muted text-primary",
  },
  approved: {
    chip: "bg-success-soft text-success",
    iconTile: "bg-success-soft text-success",
  },
  rejected: {
    chip: "bg-danger-soft text-danger",
    iconTile: "bg-danger-soft text-danger",
  },
};

const STEP_TILE_STYLE: Record<StepStatus, string> = {
  pending: "bg-surface-2 text-text-subtle",
  approved: "bg-success-soft text-success",
  rejected: "bg-danger-soft text-danger",
};

function cardStatus(steps: PlanCardStep[]): StepStatus {
  if (steps.some((s) => s.status === "rejected")) return "rejected";
  if (steps.length > 0 && steps.every((s) => s.status === "approved")) return "approved";
  return "pending";
}

function buttonVariant(label: string, idx: number): string {
  // First action = primary CTA (Approve). Others = ghost.
  const isPrimary = idx === 0 || /approve|批准|同意/i.test(label);
  if (isPrimary) {
    return "bg-primary text-primary-fg shadow-soft-sm hover:bg-primary-hover hover:shadow-soft";
  }
  return "border border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2";
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
  const style = CARD_STATUS_STYLE[status];

  const total = steps.length;
  const approved = steps.filter((s) => s.status === "approved").length;
  const progress = total > 0 ? Math.round((approved / total) * 100) : 0;

  return (
    <article
      data-component="PlanCard"
      data-plan-id={planId}
      data-status={status}
      className="relative overflow-hidden rounded-xl border border-border bg-surface p-5 shadow-soft-sm"
    >
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${style.iconTile}`}
        >
          <Icon name="list" size={16} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold tracking-tight text-text">
            {title}
          </h3>
          {planId && (
            <p className="mt-0.5 truncate font-mono text-[11px] text-text-subtle">
              {planId}
            </p>
          )}
        </div>
        <span
          className={`inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[11px] font-semibold ${style.chip}`}
        >
          {STATUS_LABEL_ZH[status]}
        </span>
      </header>

      {total > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-base ease-out"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <span className="font-mono text-[10px] text-text-subtle">
            {approved}/{total}
          </span>
        </div>
      )}

      <ol className="mt-4 space-y-2">
        {steps.map((step, idx) => (
          <li
            key={step.id}
            data-step-id={step.id}
            data-status={step.status}
            className="flex items-start gap-3 rounded-lg border border-border bg-surface-2/50 p-3"
          >
            <span
              aria-label={STATUS_LABEL_ZH[step.status]}
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ${STEP_TILE_STYLE[step.status]}`}
            >
              <Icon name={STEP_ICON[step.status]} size={12} strokeWidth={2.25} />
            </span>
            <span className="w-5 shrink-0 pt-0.5 font-mono text-[10px] text-text-subtle">
              {String(idx + 1).padStart(2, "0")}
            </span>
            <div className="flex-1 min-w-0">
              <span
                className={
                  step.status === "rejected"
                    ? "text-[13px] text-text-muted line-through"
                    : "text-[13px] text-text"
                }
              >
                {step.title}
              </span>
              {step.body && (
                <span className="mt-1 block whitespace-pre-wrap text-[12px] leading-5 text-text-muted">
                  {step.body}
                </span>
              )}
            </div>
          </li>
        ))}
        {steps.length === 0 && (
          <li className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-text-muted">
            (no steps)
          </li>
        )}
      </ol>

      {buttons.length > 0 && (
        <footer className="mt-5 flex items-center gap-2">
          {buttons.map((b, idx) => (
            <button
              key={`${b.label}-${b.action}`}
              type="button"
              data-interaction-label={b.label}
              data-interaction-action={b.action}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-[background-color,border-color,box-shadow] duration-fast ease-out ${buttonVariant(b.label, idx)}`}
            >
              {b.label}
            </button>
          ))}
        </footer>
      )}
    </article>
  );
}
