"use client";

import { useState } from "react";
import { PlusIcon, MinusIcon } from "@/components/ui/icons";

export type NestedRunStatus = "running" | "done" | "error" | "unknown";

type Props = {
  runId: string;
  parentRunId: string | null;
  employeeName: string;
  status: NestedRunStatus;
  children?: React.ReactNode;
  defaultCollapsed?: boolean;
};

const STATUS_COLOR: Record<NestedRunStatus, string> = {
  running: "text-primary",
  done: "text-success",
  error: "text-danger",
  unknown: "text-text-muted",
};

const STATUS_LABEL: Record<NestedRunStatus, string> = {
  running: "运行中",
  done: "已完成",
  error: "失败",
  unknown: "—",
};

export function NestedRunBlock({
  employeeName,
  status,
  children,
  defaultCollapsed = true,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const color = STATUS_COLOR[status];
  const label = STATUS_LABEL[status];

  return (
    <div className="ml-6 border-l-2 border-border pl-3">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-2 transition-colors duration-base text-[12px]"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle shrink-0">
          dispatch
        </span>
        <span className="font-medium text-text truncate">{employeeName}</span>
        <span className={`ml-auto font-medium ${color} shrink-0`}>{label}</span>
        <span className="text-text-muted shrink-0" aria-hidden="true">
          {collapsed ? <PlusIcon size={12} /> : <MinusIcon size={12} />}
        </span>
      </button>
      {!collapsed && children && (
        <div className="mt-1 pl-1 space-y-2">{children}</div>
      )}
    </div>
  );
}
