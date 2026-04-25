"use client";

/**
 * LatencyHeatmap · 24h x N-buckets duration grid.
 *
 * Honeycomb-inspired view: each cell is one hour × one latency bucket;
 * the cell's intensity scales with the count of runs that fell into it.
 * Helps the user see at a glance "do we have long-tail latency this
 * morning?" without leaving the dashboard.
 *
 * The data is pre-aggregated by ObservatoryService.get_summary so this
 * component is a pure render — no fetch, no derived state.
 */

import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";

export type LatencyHeatmapProps = {
  /** rows are hours (oldest left → newest right), cols are buckets. */
  cells: number[][];
  /** Upper-edge of each non-tail bucket in seconds. Last bucket is open-ended. */
  buckets: number[];
};

export function LatencyHeatmap({ cells, buckets }: LatencyHeatmapProps) {
  const t = useTranslations("pages.observatory.heatmap");
  const totalRuns = cells.reduce(
    (acc, row) => acc + row.reduce((a, b) => a + b, 0),
    0,
  );
  if (cells.length === 0) {
    return (
      <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 h-11 border-b border-border">
          <div className="h-6 w-6 rounded-md bg-primary/10 text-primary grid place-items-center">
            <Icon name="activity" size={13} />
          </div>
          <span className="text-[13px] font-semibold text-text">
            {t("title")}
          </span>
        </div>
        <div className="px-5 py-6 text-[12px] text-text-muted">{t("empty")}</div>
      </div>
    );
  }

  const max = Math.max(1, ...cells.flat());
  const colCount = cells.length || 24;
  const rowCount = (cells[0]?.length ?? 0) || buckets.length + 1;

  // Y-axis labels: bucket upper edges; last is open ("≥Xs")
  const yLabels: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    if (r === rowCount - 1) {
      const last = buckets[buckets.length - 1] ?? 0;
      yLabels.push(`≥${last < 60 ? `${last}s` : `${(last / 60).toFixed(0)}m`}`);
    } else {
      const upper = buckets[r] ?? 0;
      yLabels.push(`<${upper < 1 ? `${(upper * 1000).toFixed(0)}ms` : upper < 60 ? `${upper}s` : `${(upper / 60).toFixed(0)}m`}`);
    }
  }

  return (
    <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 h-11 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-primary/10 text-primary grid place-items-center">
            <Icon name="activity" size={13} />
          </div>
          <span className="text-[13px] font-semibold text-text">
            {t("title")}
          </span>
        </div>
        <span className="text-[11px] font-mono text-text-subtle">
          {t("hint", { runs: totalRuns })}
        </span>
      </div>
      <div className="p-4 overflow-x-auto">
        <div className="inline-grid grid-flow-col auto-cols-[minmax(0,1fr)] gap-[2px] items-end">
          {/* Y-axis label column */}
          <div
            className="grid gap-[2px] mr-2 select-none"
            style={{
              gridTemplateRows: `repeat(${rowCount}, 14px)`,
            }}
          >
            {[...yLabels].reverse().map((label, i) => (
              <div
                key={i}
                className="font-mono text-[10px] text-text-subtle tabular-nums whitespace-nowrap text-right pr-1 leading-[14px]"
              >
                {label}
              </div>
            ))}
          </div>
          {/* Cells columns · oldest hour first */}
          {Array.from({ length: colCount }, (_, h) => (
            <div
              key={h}
              className="grid gap-[2px]"
              style={{
                gridTemplateRows: `repeat(${rowCount}, 14px)`,
              }}
            >
              {Array.from({ length: rowCount }, (_, r) => {
                // r=0 → top of column = bucket index (rowCount - 1) (largest)
                const bucketIdx = rowCount - 1 - r;
                const v = cells[h]?.[bucketIdx] ?? 0;
                const intensity = v === 0 ? 0 : 0.15 + (0.85 * v) / max;
                const bg =
                  v === 0
                    ? "rgba(0,0,0,0)"
                    : `rgba(37, 99, 235, ${intensity.toFixed(3)})`;
                return (
                  <div
                    key={r}
                    title={`${yLabels[bucketIdx]} · ${v} runs`}
                    className="w-3 rounded-[2px] border border-border/40"
                    style={{ background: bg }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {/* X-axis label */}
        <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-text-subtle pl-12">
          <span>{t("oldest")}</span>
          <span>{t("now")}</span>
        </div>
      </div>
    </div>
  );
}
