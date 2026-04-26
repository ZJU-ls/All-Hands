"use client";

/**
 * SubagentProgressSection · ADR 0019 C2
 *
 * Collapsible section listing active sub-agent dispatches. Header
 * shows running count; expand to see per-row status + a "查看链路 →"
 * button that pushes ?trace=<run_id> (the existing RunTraceDrawer
 * picks it up). Expand state persists in localStorage.
 */

import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { TRACE_QUERY_KEY } from "@/components/runs/TraceChip";
import type { ActiveSubagent } from "./progress-hooks";

const STORAGE_KEY = "allhands.progress.subagent.expanded";

type Props = { subagents: ActiveSubagent[]; embedded?: boolean };

export function SubagentProgressSection({ subagents, embedded = false }: Props) {
  const t = useTranslations("chat.subagent");
  const [expanded, setExpanded] = useState<boolean>(true);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (embedded) return;
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      if (v === "false") setExpanded(false);
    } catch {
      /* defaults expanded */
    }
  }, [embedded]);

  const toggle = () => {
    if (embedded) return;
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const openTrace = (runId: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set(TRACE_QUERY_KEY, runId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const running = subagents.filter((s) => s.status === "running").length;

  const rowList = (
    <div className={cn("space-y-px px-2", embedded ? "py-2" : "px-3 pb-2 pt-0.5")}>
      {subagents.map((s) => (
        <div
          key={s.toolCallId}
          data-testid={`subagent-row-${s.toolCallId}`}
          data-status={s.status}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 transition-[background-color]",
            s.status === "running" ? "bg-primary-muted/40" : "hover:bg-surface-2",
          )}
        >
          <SubagentDot status={s.status} />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              s.status === "failed" ? "text-danger" : "text-text",
            )}
            title={s.name}
          >
            {s.name}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-text-subtle">
            {t(`status.${s.status}`)}
          </span>
          {s.runId ? (
            <button
              type="button"
              onClick={() => openTrace(s.runId!)}
              data-testid={`subagent-trace-${s.toolCallId}`}
              className="shrink-0 rounded-md border border-primary/30 bg-primary-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-primary transition-[background-color,border-color] duration-fast hover:border-primary/50 hover:bg-primary-muted"
            >
              {t("viewTrace")}
            </button>
          ) : (
            <span className="w-[68px] shrink-0" aria-hidden />
          )}
        </div>
      ))}
    </div>
  );

  if (embedded) {
    return (
      <div data-testid="subagent-progress-section" data-embedded="true">
        {rowList}
      </div>
    );
  }

  return (
    <div data-testid="subagent-progress-section">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-[background-color] duration-fast hover:bg-surface-2"
      >
        <Icon
          name={expanded ? "chevron-down" : "chevron-right"}
          size={11}
          className="shrink-0 text-text-subtle"
        />
        <span
          aria-hidden="true"
          className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-primary-muted/60 text-primary"
        >
          <Icon name="users" size={11} />
        </span>
        <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-text">
          {t("title")}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-text-muted">
          {subagents.length}
          {running > 0 && (
            <span className="ml-1.5 text-primary">{t("runningCount", { n: running })}</span>
          )}
        </span>
      </button>
      {expanded && rowList}
    </div>
  );
}

function SubagentDot({ status }: { status: ActiveSubagent["status"] }) {
  const tStatus = useTranslations("chat.subagent.status");
  if (status === "running") {
    return (
      <span
        aria-label={tStatus("running")}
        className={cn(
          "inline-block h-2 w-2 shrink-0 rounded-full bg-primary",
          "shadow-[0_0_0_3px_rgba(79,140,255,0.18)] animate-pulse",
        )}
      />
    );
  }
  if (status === "succeeded") {
    return (
      <span
        aria-label={tStatus("succeeded")}
        className="inline-block h-2 w-2 shrink-0 rounded-full bg-success"
      />
    );
  }
  return (
    <span
      aria-label={tStatus("failed")}
      className="inline-block h-2 w-2 shrink-0 rounded-full bg-danger"
    />
  );
}
