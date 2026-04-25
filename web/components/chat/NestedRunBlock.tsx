"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

export type NestedRunStatus = "running" | "done" | "error" | "unknown";

type Props = {
  runId: string;
  parentRunId: string | null;
  employeeName: string;
  status: NestedRunStatus;
  children?: React.ReactNode;
  defaultCollapsed?: boolean;
};

const STATUS_DOT: Record<NestedRunStatus, string> = {
  running: "bg-primary",
  done: "bg-success",
  error: "bg-danger",
  unknown: "bg-text-subtle",
};

const STATUS_COLOR: Record<NestedRunStatus, string> = {
  running: "text-primary",
  done: "text-success",
  error: "text-danger",
  unknown: "text-text-muted",
};

const STATUS_LABEL_KEY: Record<NestedRunStatus, "running" | "done" | "error" | "unknown"> = {
  running: "running",
  done: "done",
  error: "error",
  unknown: "unknown",
};

export function NestedRunBlock({
  employeeName,
  status,
  children,
  defaultCollapsed = true,
}: Props) {
  const t = useTranslations("chat.nestedRun");
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const color = STATUS_COLOR[status];
  const label = t(STATUS_LABEL_KEY[status]);
  const dot = STATUS_DOT[status];

  return (
    <div className="ml-6 border-l-2 border-border pl-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md border border-transparent bg-surface-2/40 px-2.5 py-1.5 text-[12px] transition-colors duration-fast hover:bg-surface-2 hover:border-border"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
            dot,
            status === "running" && "animate-[ah-pulse_1.6s_ease-in-out_infinite]",
          )}
        />
        <Icon name="users" size={12} className="shrink-0 text-text-subtle" />
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-subtle">
          dispatch
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-text">{employeeName}</span>
        <span className={cn("shrink-0 text-[11px] font-medium", color)}>{label}</span>
        <Icon
          name={collapsed ? "chevron-down" : "chevron-up"}
          size={12}
          className="shrink-0 text-text-subtle"
        />
      </button>
      {!collapsed && children && (
        <div className="mt-1.5 pl-1 space-y-2">{children}</div>
      )}
    </div>
  );
}
