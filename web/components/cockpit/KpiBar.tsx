"use client";

import Link from "next/link";
import type { WorkspaceSummaryDto } from "@/lib/cockpit-api";

type Tone = "neutral" | "warn";
type Kpi = {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: Tone;
};

function buildKpis(s: WorkspaceSummaryDto): Kpi[] {
  const cost = s.estimated_cost_today_usd.toFixed(2);
  const tasksTone: Tone = s.tasks_needs_user > 0 ? "warn" : "neutral";
  const runsTone: Tone = s.runs_failing_recently > 0 ? "warn" : "neutral";
  return [
    {
      label: "员工",
      value: String(s.employees_total),
      hint: `${s.conversations_today} 对话 / 24h`,
      href: "/employees",
    },
    {
      label: "任务",
      value: String(s.tasks_active),
      hint:
        s.tasks_needs_user > 0
          ? `${s.tasks_needs_user} 等你处理`
          : s.tasks_active > 0
            ? "执行中"
            : "—",
      href: "/tasks",
      tone: tasksTone,
    },
    {
      label: "进行中 · Run",
      value: String(s.runs_active),
      hint: s.runs_failing_recently > 0 ? `${s.runs_failing_recently} 失败 / 1h` : "—",
      tone: runsTone,
    },
    {
      label: "触发器",
      value: String(s.triggers_active),
      hint: "已启用",
      href: "/triggers",
    },
    {
      label: "制品",
      value: String(s.artifacts_total),
      hint: `+${s.artifacts_this_week_delta} 本周`,
    },
    {
      label: "Tokens / 24h",
      value: formatTokens(s.tokens_today_total),
      hint: `in ${formatTokens(s.tokens_today_prompt)} · out ${formatTokens(
        s.tokens_today_completion,
      )}`,
    },
    {
      label: "成本 / 24h",
      value: `$${cost}`,
      hint: s.tokens_today_total > 0 ? "估算" : "—",
    },
  ];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function KpiCell({ k }: { k: Kpi }) {
  const toneClass =
    k.tone === "warn"
      ? "bg-warning/5 border-l-2 border-warning"
      : "bg-surface";
  const base = `px-4 py-3 flex flex-col gap-1 min-w-0 transition-colors duration-base ${toneClass}`;
  const content = (
    <>
      <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle truncate">
        {k.label}
      </div>
      <div
        className={`text-[22px] font-semibold tabular-nums leading-none ${
          k.tone === "warn" ? "text-warning" : "text-text"
        }`}
      >
        {k.value}
      </div>
      {k.hint && (
        <div className="font-mono text-[10px] text-text-subtle truncate">
          {k.hint}
        </div>
      )}
    </>
  );
  if (k.href) {
    return (
      <Link
        href={k.href}
        className={`${base} hover:bg-surface-2 cursor-pointer`}
        data-testid={`kpi-${k.label}`}
      >
        {content}
      </Link>
    );
  }
  return (
    <div className={base} data-testid={`kpi-${k.label}`}>
      {content}
    </div>
  );
}

export function KpiBar({ summary }: { summary: WorkspaceSummaryDto }) {
  const kpis = buildKpis(summary);
  const pendingFlag = summary.confirmations_pending > 0;
  const tasksNeedsUser = summary.tasks_needs_user > 0;

  return (
    <div className="flex flex-col gap-2">
      {tasksNeedsUser && (
        <div
          data-testid="tasks-needs-user-banner"
          className="flex items-center justify-between rounded border border-warning/40 bg-warning/5 px-3 py-2 text-[12px]"
        >
          <span className="text-warning font-medium">
            ● {summary.tasks_needs_user} 个任务在等你回答或审批
          </span>
          <Link
            href="/tasks?filter=needs_user"
            className="font-mono text-[11px] text-warning hover:underline"
          >
            去处理 →
          </Link>
        </div>
      )}
      {pendingFlag && (
        <div className="flex items-center justify-between rounded border border-warning/40 bg-warning/5 px-3 py-2 text-[12px]">
          <span className="text-warning font-medium">
            ● {summary.confirmations_pending} 个待确认 tool call
          </span>
          <Link
            href="/confirmations"
            className="font-mono text-[11px] text-warning hover:underline"
          >
            查看 →
          </Link>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-px rounded border border-border bg-border overflow-hidden">
        {kpis.map((k) => (
          <KpiCell key={k.label} k={k} />
        ))}
      </div>
    </div>
  );
}
