"use client";

import Link from "next/link";
import { deriveProfile, BADGE_LABEL, type EmployeeForBadges } from "@/lib/employee-profile";

export type ConversationHeaderEmployee = EmployeeForBadges & {
  id: string;
  name: string;
  description?: string | null;
};

type Props = {
  employee: ConversationHeaderEmployee | null;
  conversationTitle?: string | null;
};

export function ConversationHeader({ employee, conversationTitle }: Props) {
  if (!employee) {
    return (
      <div className="flex items-center gap-2 text-text-muted text-[13px]">
        <span className="font-medium text-text">加载中…</span>
      </div>
    );
  }

  const badges = deriveProfile(employee);
  const extraBadges = badges.filter((b) => b !== "react");
  const isLead = Boolean(employee.is_lead_agent);

  return (
    <div className="flex items-center gap-3 min-w-0">
      <Link
        href={`/employees/${employee.id}`}
        className="flex items-center gap-2 min-w-0 text-text hover:text-primary transition-colors duration-base"
        aria-label={`查看员工 ${employee.name} 主页`}
      >
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle shrink-0">
          {isLead ? "lead" : "emp"}
        </span>
        <span className="font-medium text-[13px] truncate">{employee.name}</span>
      </Link>
      <div className="flex items-center gap-1 shrink-0">
        {isLead && (
          <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-text-muted">
            全能
          </span>
        )}
        {extraBadges.map((b) => (
          <span
            key={b}
            className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-text-muted"
          >
            {BADGE_LABEL[b]}
          </span>
        ))}
      </div>
      {conversationTitle && (
        <>
          <span className="text-text-subtle shrink-0" aria-hidden="true">
            /
          </span>
          <span className="text-text-muted text-[12px] truncate">{conversationTitle}</span>
        </>
      )}
    </div>
  );
}
