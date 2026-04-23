"use client";

/**
 * KpiBar · Cockpit's top KPI console.
 *
 * 7 equal-width cells with large tabular numerals, a subtle per-cell
 * sparkline micro-viz (dashed baseline while time-series is unavailable —
 * we never fabricate trend data), and a 2px primary activation bar on
 * the left edge when the cell turns warn-tone.
 *
 * All pending-attention banners (tasks needing user, confirmations
 * pending, paused) previously living here have moved to the HUD strip
 * above — they are global runtime state, not KPI rows.
 */

import Link from "next/link";
import { Sparkline } from "@/components/ui/Sparkline";
import type { WorkspaceSummaryDto } from "@/lib/cockpit-api";

type Tone = "neutral" | "warn";
type Kpi = {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: Tone;
  /** Time-series for the sparkline; empty = render dashed baseline. */
  trend?: number[];
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function buildKpis(s: WorkspaceSummaryDto): Kpi[] {
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
      value: `$${s.estimated_cost_today_usd.toFixed(2)}`,
      hint: s.tokens_today_total > 0 ? "估算" : "—",
    },
  ];
}

function KpiCell({ k }: { k: Kpi }) {
  const warn = k.tone === "warn";
  const numberColor = warn ? "text-warning" : "text-text";
  const sparkColor = warn ? "text-warning" : "text-primary";
  const base =
    "relative flex flex-col gap-1.5 px-4 pt-3 pb-2.5 min-w-0 bg-surface transition-colors duration-base";
  const content = (
    <>
      {warn && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r bg-warning"
          style={{
            animation: "ah-bar-in 180ms var(--ease-out) both",
            transformOrigin: "center",
          }}
        />
      )}
      <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle truncate">
        {k.label}
      </div>
      <div
        className={`font-mono text-[28px] font-semibold tabular-nums leading-none ${numberColor}`}
      >
        {k.value}
      </div>
      <div className={`h-6 ${sparkColor}`}>
        <Sparkline
          values={k.trend ?? []}
          height={24}
          strokeWidth={1.25}
          showEndpoint={(k.trend?.length ?? 0) > 1}
        />
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
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-px rounded border border-border bg-border overflow-hidden">
      {kpis.map((k) => (
        <KpiCell key={k.label} k={k} />
      ))}
    </div>
  );
}
