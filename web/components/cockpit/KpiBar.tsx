"use client";

import type { WorkspaceSummaryDto } from "@/lib/cockpit-api";

type Kpi = { label: string; value: string; hint?: string };

function buildKpis(s: WorkspaceSummaryDto): Kpi[] {
  const cost = s.estimated_cost_today_usd.toFixed(2);
  return [
    {
      label: "员工",
      value: String(s.employees_total),
      hint: `${s.conversations_today} 对话 / 24h`,
    },
    {
      label: "进行中",
      value: String(s.runs_active),
      hint: s.runs_failing_recently > 0 ? `${s.runs_failing_recently} 失败 / 1h` : "—",
    },
    {
      label: "触发器",
      value: String(s.triggers_active),
      hint: "已启用",
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

export function KpiBar({ summary }: { summary: WorkspaceSummaryDto }) {
  const kpis = buildKpis(summary);
  const pendingFlag = summary.confirmations_pending > 0;

  return (
    <div className="flex flex-col gap-2">
      {pendingFlag && (
        <div className="flex items-center justify-between rounded border border-warning/40 bg-warning/5 px-3 py-2 text-[12px]">
          <span className="text-warning font-medium">
            ⚠ {summary.confirmations_pending} 个待确认 tool call
          </span>
          <a
            href="/confirmations"
            className="font-mono text-[11px] text-warning hover:underline"
          >
            查看 →
          </a>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px rounded border border-border bg-border overflow-hidden">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-surface px-4 py-3 flex flex-col gap-1 min-w-0"
          >
            <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle truncate">
              {k.label}
            </div>
            <div className="text-[22px] font-semibold tabular-nums text-text leading-none">
              {k.value}
            </div>
            {k.hint && (
              <div className="font-mono text-[10px] text-text-subtle truncate">
                {k.hint}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
