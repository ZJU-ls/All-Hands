"use client";

/**
 * EmployeeCard · render-tool target for create_employee (I-0008).
 *
 * Consumes the payload shape defined in backend allhands/api/protocol.py
 * `EmployeeCardProps` and mirrored in web/lib/protocol.ts. When Lead Agent
 * invokes `create_employee` the tool result is wrapped as
 * `{component: "EmployeeCard", props}` so the new employee renders inline
 * in chat — no navigation required (N1 Tool-First redemption, W2).
 *
 * Visual contract (product/03-visual-design.md · design-system/MASTER.md):
 * - Linear Precise: bg-surface / border-border · color density ≤ 3 + semantic
 * - No icon library. The "avatar" is a 28-px square dot-grid tile with the
 *   first letter rendered in mono (no real headshot / image).
 * - Active employees carry a 2-px left accent bar (bg-primary); draft / paused
 *   fall back to neutral tokens.
 * - Status label + meta line use mono characters (`· → ⌘`) per CLAUDE.md §3.5.
 */

import type { RenderProps } from "@/lib/component-registry";

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
};

const STATUS_LABEL: Record<Status, string> = {
  draft: "draft",
  active: "active",
  paused: "paused",
};

const STATUS_DOT_CLASS: Record<Status, string> = {
  draft: "text-text-subtle",
  active: "text-primary",
  paused: "text-warn",
};

function firstLetter(name: string, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback.trim().charAt(0).toUpperCase();
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "·";
}

export function EmployeeCard({ props }: RenderProps) {
  const p = props as Partial<EmployeeCardPayload>;
  const name = typeof p.name === "string" && p.name ? p.name : "(未命名员工)";
  const role = typeof p.role === "string" ? p.role : "";
  const preview =
    typeof p.system_prompt_preview === "string" ? p.system_prompt_preview : "";
  const status: Status = (p.status as Status) ?? "draft";
  const model = p.model && typeof p.model === "object" ? (p.model as ModelRef) : undefined;
  const skillCount = typeof p.skill_count === "number" ? p.skill_count : undefined;
  const toolCount = typeof p.tool_count === "number" ? p.tool_count : undefined;
  const initial = firstLetter(name, p.avatar_initial);

  return (
    <article
      data-component="EmployeeCard"
      data-status={status}
      className="relative rounded-md border border-border bg-surface pl-4 pr-4 py-4"
    >
      {status === "active" && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r bg-primary"
        />
      )}

      <header className="flex items-start gap-3">
        <DotGridAvatar initial={initial} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold tracking-tight text-text truncate">
              {name}
            </h3>
            <span
              aria-label={`status:${status}`}
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-text-subtle"
            >
              <span aria-hidden="true" className={STATUS_DOT_CLASS[status]}>
                ·
              </span>
              {STATUS_LABEL[status]}
            </span>
          </div>
          {role && (
            <p className="mt-0.5 text-[11px] text-text-muted truncate">{role}</p>
          )}
        </div>
      </header>

      {preview && (
        <p className="mt-3 text-[12px] leading-5 text-text-muted line-clamp-3">
          {preview}
        </p>
      )}

      <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-text-subtle">
        {typeof skillCount === "number" && (
          <MetaItem label="skills" value={String(skillCount)} />
        )}
        {typeof toolCount === "number" && (
          <MetaItem label="tools" value={String(toolCount)} />
        )}
        {model && <MetaItem label="model" value={`${model.provider}/${model.name}`} />}
      </dl>
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

function DotGridAvatar({ initial }: { initial: string }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-sm border border-border bg-surface-2 text-[11px] font-mono text-text"
    >
      <span
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-text-subtle) 0.5px, transparent 0.5px)",
          backgroundSize: "4px 4px",
        }}
      />
      <span className="relative z-[1]">{initial}</span>
    </span>
  );
}
