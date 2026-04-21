"use client";

import Link from "next/link";
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
        {/* eslint-disable-next-line no-restricted-syntax */}
        <span className="font-medium text-text">加载中…</span>
      </div>
    );
  }

  // Header is intentionally lean: link to the employee (name only — the
  // "lead/emp" prefix + capability badges live on the employee detail page,
  // where they actually belong), optional conversation title, and the
  // effective-model chip. Everything else was pushed into the employee page
  // so each chat window surfaces only what changes per-conversation.
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Link
        href={`/employees/${employee.id}`}
        className="min-w-0 text-text hover:text-primary transition-colors duration-base"
        aria-label={`查看员工 ${employee.name} 主页`}
      >
        <span className="font-medium text-[13px] truncate">{employee.name}</span>
      </Link>
      {conversationTitle && (
        <>
          <span className="text-text-subtle shrink-0" aria-hidden="true">
            /
          </span>
          <span className="text-text-muted text-[12px] truncate">{conversationTitle}</span>
        </>
      )}
      {modelDisplayName(effectiveModelRef) && (
        <span
          data-testid="conversation-header-model-badge"
          data-overridden={isOverridden ? "true" : "false"}
          title={
            isOverridden
              ? `本对话覆盖为 ${effectiveModelRef}`
              : `跟随员工默认 · ${effectiveModelRef}`
          }
          className="inline-flex h-5 items-center gap-1 rounded border border-border px-1.5 font-mono text-[10px] text-text-muted shrink-0"
        >
          {isOverridden && (
            <span
              aria-hidden="true"
              className="inline-block h-1 w-1 rounded-full bg-primary"
            />
          )}
          {modelDisplayName(effectiveModelRef)}
        </span>
      )}
    </div>
  );
}
