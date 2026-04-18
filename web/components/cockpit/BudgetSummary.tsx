"use client";

import type { WorkspaceSummaryDto } from "@/lib/cockpit-api";

function kFormat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function BudgetSummary({ summary }: { summary: WorkspaceSummaryDto }) {
  const promptPct =
    summary.tokens_today_total > 0
      ? Math.round((summary.tokens_today_prompt / summary.tokens_today_total) * 100)
      : 0;
  return (
    <section className="flex flex-col min-h-0">
      <header className="flex items-center justify-between h-8 px-3 border-b border-border">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          今日消耗
        </span>
      </header>
      <div className="px-3 py-3 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-text-muted">估算成本</span>
          <span className="text-[16px] font-semibold tabular-nums text-text">
            ${summary.estimated_cost_today_usd.toFixed(2)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-text-muted">Tokens</span>
          <span className="font-mono text-[12px] tabular-nums text-text">
            {kFormat(summary.tokens_today_total)}
          </span>
        </div>
        {summary.tokens_today_total > 0 && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-sm bg-surface-2 overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{ width: `${promptPct}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="flex items-center justify-between font-mono text-[10px] text-text-subtle tabular-nums">
              <span>in {kFormat(summary.tokens_today_prompt)}</span>
              <span>out {kFormat(summary.tokens_today_completion)}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
