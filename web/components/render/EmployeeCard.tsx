"use client";

/**
 * EmployeeCard · render target for `create_employee` (I-0008).
 *
 * V2-level (ADR 0016 · Brand-Blue Dual Theme)
 * - Gradient avatar tile (primary → primary-hover, 135°) with initial.
 * - Role + "Lead" chips · status dot · description · meta row.
 * - `rounded-xl border border-border bg-surface shadow-soft-sm` shell, lifts
 *   one pixel on hover via `hover:shadow-soft hover:-translate-y-px`.
 * - Active employees keep the 2px left `bg-primary` accent bar — the test
 *   suite asserts the class exists / is absent by status.
 *
 * Props + `data-*` contract preserved so existing tests + the render
 * registry keep working (see `web/tests/employee-card.test.tsx`).
 */

import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import type { RenderInteraction, RenderProps } from "@/lib/component-registry";

type Status = "draft" | "active" | "paused";

type ModelRef = {
  provider: string;
  name: string;
};

type EmployeeCardPayload = {
  employee_id: string;
  name: string;
  role?: string;
  avatar_initial?: string;
  system_prompt_preview?: string;
  skill_count?: number;
  tool_count?: number;
  model?: ModelRef;
  status?: Status;
  is_lead?: boolean;
};

const STATUS_DOT_CLASS: Record<Status, string> = {
  draft: "bg-text-subtle",
  active: "bg-success",
  paused: "bg-warning",
};

function firstLetter(name: string, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback.trim().charAt(0).toUpperCase();
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "·";
}

function chatInteraction(
  interactions: readonly RenderInteraction[] | undefined,
): RenderInteraction | undefined {
  if (!interactions) return undefined;
  return (
    interactions.find((i) => i.action === "open_chat") ??
    interactions.find((i) => i.action === "send_message") ??
    interactions[0]
  );
}

export function EmployeeCard({ props, interactions }: RenderProps) {
  const t = useTranslations("render.employeeCard");
  const p = props as Partial<EmployeeCardPayload>;
  const name = typeof p.name === "string" && p.name ? p.name : t("untitled");
  const role = typeof p.role === "string" ? p.role : "";
  const preview =
    typeof p.system_prompt_preview === "string" ? p.system_prompt_preview : "";
  const status: Status = (p.status as Status) ?? "draft";
  const isLead = Boolean(p.is_lead);
  const model = p.model && typeof p.model === "object" ? (p.model as ModelRef) : undefined;
  const skillCount = typeof p.skill_count === "number" ? p.skill_count : undefined;
  const toolCount = typeof p.tool_count === "number" ? p.tool_count : undefined;
  const initial = firstLetter(name, p.avatar_initial);
  const cta = chatInteraction(interactions);

  return (
    <article
      data-component="EmployeeCard"
      data-status={status}
      className="group relative overflow-hidden rounded-xl border border-border bg-surface p-5 shadow-soft-sm transition-[transform,box-shadow,border-color] duration-base ease-out hover:-translate-y-px hover:border-border-strong hover:shadow-soft"
    >
      {status === "active" && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-4 bottom-4 w-[2px] rounded-r bg-primary"
        />
      )}

      <header className="flex items-start gap-4">
        <div
          aria-hidden="true"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[15px] font-semibold tracking-tight text-primary-fg shadow-soft-sm"
          style={{
            backgroundImage:
              "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)",
          }}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold tracking-tight text-text">
              {name}
            </h3>
            {isLead && (
              <span className="inline-flex h-5 items-center rounded-md bg-primary-muted px-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                lead
              </span>
            )}
            <span
              aria-label={`status:${status}`}
              className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-subtle"
            >
              <span
                aria-hidden="true"
                className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASS[status]}`}
              />
              {t(`status.${status}`)}
            </span>
          </div>
          {role && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex h-5 items-center rounded-md border border-border bg-surface-2 px-1.5 text-[11px] text-text-muted">
                {role}
              </span>
            </div>
          )}
        </div>
      </header>

      {preview && (
        <p className="mt-4 line-clamp-3 text-sm leading-6 text-text-muted">{preview}</p>
      )}

      <dl className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-text-subtle">
        {typeof skillCount === "number" && (
          <MetaItem label="skills" value={String(skillCount)} />
        )}
        {typeof toolCount === "number" && (
          <MetaItem label="tools" value={String(toolCount)} />
        )}
        {model && <MetaItem label="model" value={`${model.provider}/${model.name}`} />}
      </dl>

      {cta && (
        <footer className="mt-5 flex items-center gap-2">
          <button
            type="button"
            data-interaction-label={cta.label}
            data-interaction-action={cta.action}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-fg shadow-soft-sm transition-[background-color,box-shadow] duration-fast ease-out hover:bg-primary-hover hover:shadow-soft"
          >
            <Icon name="message-square" size={14} strokeWidth={2} />
            {cta.label || t("chat")}
          </button>
        </footer>
      )}
    </article>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <dt className="uppercase tracking-wider">{label}</dt>
      <dd className="text-text">{value}</dd>
    </span>
  );
}
