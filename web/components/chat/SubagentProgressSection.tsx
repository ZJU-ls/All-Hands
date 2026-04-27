"use client";

/**
 * SubagentProgressSection · ADR 0019 C2
 *
 * Collapsible section listing active sub-agent dispatches. Header shows
 * running count; expand to see per-row status + a "查看链路 →" link to
 * the observatory L3 trace page (`/observatory/runs/<run_id>`). Expand
 * state persists in localStorage.
 *
 * Pre-2026-04-27 the link pushed `?trace=<id>` and a global drawer popped
 * over chat. That coupled trace viewing to chat UX; trace was moved into
 * observatory's L3 to close the five-tier drilldown loop.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { traceHref } from "@/components/runs/TraceChip";
import type { ActiveSubagent } from "./progress-hooks";

const STORAGE_KEY = "allhands.progress.subagent.expanded";

type Props = { subagents: ActiveSubagent[]; embedded?: boolean };

export function SubagentProgressSection({ subagents, embedded = false }: Props) {
  const t = useTranslations("chat.subagent");
  const [expanded, setExpanded] = useState<boolean>(true);

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
            <Link
              href={traceHref(s.runId)}
              data-testid={`subagent-trace-${s.toolCallId}`}
              className="shrink-0 rounded-md border border-primary/30 bg-primary-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-primary transition-[background-color,border-color] duration-fast hover:border-primary/50 hover:bg-primary-muted"
            >
              {t("viewTrace")}
            </Link>
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
