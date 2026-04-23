"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { EmployeeForBadges } from "@/lib/employee-profile";

export type ConversationHeaderEmployee = EmployeeForBadges & {
  id: string;
  name: string;
  description?: string | null;
};

type Props = {
  employee: ConversationHeaderEmployee | null;
  conversationTitle?: string | null;
  /** The effective model for this conversation (override → employee default).
   * Rendered as a compact read-only chip so the user can always see which
   * brain is answering, without the edit affordance — picking is done in the
   * Composer next to the thinking toggle. */
  effectiveModelRef?: string | null;
  /** When true the read-only chip shows the "overridden" dot, mirroring the
   * interactive picker in the Composer so both surfaces tell the same story. */
  isOverridden?: boolean;
};

function modelDisplayName(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const idx = ref.indexOf("/");
  return idx >= 0 ? ref.slice(idx + 1) : ref;
}

function employeeInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return "·";
  // Use first 1-2 chars — CJK collapses to a single char, latin to two.
  const first = clean[0] ?? "·";
  const second = clean.length > 1 && /[a-zA-Z]/.test(first) ? clean[1] ?? "" : "";
  return (first + second).toUpperCase();
}

export function ConversationHeader({
  employee,
  conversationTitle,
  effectiveModelRef,
  isOverridden,
}: Props) {
  if (!employee) {
    return (
      <div
        className="flex items-center gap-2 text-text-muted text-[13px]"
        role="status"
        aria-live="polite"
      >
        {/* Inline header placeholder — a full LoadingState card would break the
            chat header layout (single flex row, 13px). Keeping a minimal inline
            label + aria-live so screen readers still hear the state. */}
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface-2">
          <Icon name="loader" size={12} className="animate-spin text-text-muted" />
        </span>
        {/* eslint-disable-next-line no-restricted-syntax */}
        <span className="font-medium text-text">加载中…</span>
      </div>
    );
  }

  const modelName = modelDisplayName(effectiveModelRef);

  return (
    <div className="flex items-center gap-3 min-w-0">
      <span
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-primary-fg shadow-soft-sm"
        style={{
          backgroundImage:
            "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
        }}
      >
        {employeeInitials(employee.name)}
      </span>
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={`/employees/${employee.id}`}
          className="min-w-0 text-text hover:text-primary transition-colors duration-base"
          aria-label={`查看员工 ${employee.name} 主页`}
        >
          <span className="font-semibold text-[14px] truncate">{employee.name}</span>
        </Link>
        {conversationTitle && (
          <>
            <span className="text-text-subtle shrink-0" aria-hidden="true">
              /
            </span>
            <span className="text-text-muted text-[12px] truncate">{conversationTitle}</span>
          </>
        )}
      </div>
      {modelName && (
        <span
          data-testid="conversation-header-model-badge"
          data-overridden={isOverridden ? "true" : "false"}
          title={
            isOverridden
              ? `本对话覆盖为 ${effectiveModelRef}`
              : `跟随员工默认 · ${effectiveModelRef}`
          }
          className={
            isOverridden
              ? "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-primary-muted px-2 font-mono text-[10px] text-primary"
              : "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 font-mono text-[10px] text-text-muted"
          }
        >
          {isOverridden && (
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-primary"
            />
          )}
          <Icon
            name="sparkles"
            size={10}
            className={isOverridden ? "text-primary" : "text-text-subtle"}
          />
          {modelName}
        </span>
      )}
    </div>
  );
}
