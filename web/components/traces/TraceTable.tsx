"use client";

import { Icon, type IconName } from "@/components/ui/icon";
import type { TraceSummaryDto } from "@/lib/observatory-api";

export type TraceSortKey = "started_at" | "duration_s" | "tokens";
export type SortDirection = "asc" | "desc";

export type TraceSort = {
  key: TraceSortKey;
  dir: SortDirection;
};

export const DEFAULT_SORT: TraceSort = { key: "started_at", dir: "desc" };

function formatDuration(s: number | null): string {
  if (s === null || s === undefined) return "—";
  if (s < 1) return `${(s * 1000).toFixed(0)}ms`;
  return `${s.toFixed(2)}s`;
}

function formatStartedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const HEAD_CELL =
  "py-2 px-3 font-mono text-[10px] uppercase tracking-[0.18em] font-medium text-text-subtle";
const HEAD_BTN =
  "inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] font-medium text-text-subtle transition-colors duration-fast hover:text-text";

export function sortTraces(traces: TraceSummaryDto[], sort: TraceSort): TraceSummaryDto[] {
  const out = traces.slice();
  out.sort((a, b) => {
    let av: number;
    let bv: number;
    if (sort.key === "duration_s") {
      av = a.duration_s ?? 0;
      bv = b.duration_s ?? 0;
    } else if (sort.key === "tokens") {
      av = a.tokens;
      bv = b.tokens;
    } else {
      av = new Date(a.started_at).getTime();
      bv = new Date(b.started_at).getTime();
    }
    return sort.dir === "asc" ? av - bv : bv - av;
  });
  return out;
}

/**
 * V2 (ADR 0016) trace table:
 *   - Header row `bg-surface-2/60` · caption-size mono uppercase with
 *     wide letter-spacing.
 *   - Rows: hover `bg-surface-2/40`; selected (matched `?trace=`) gets
 *     `bg-primary-muted` plus a 2px left `bg-primary` bar.
 *   - Status cell: tone-soft pill with matching `Icon` (success / danger).
 *   - Sortable header buttons swap chevron direction per column.
 */
export function TraceTable({
  traces,
  selectedId,
  sort,
  onSort,
  onSelect,
}: {
  traces: TraceSummaryDto[];
  selectedId: string | null;
  sort: TraceSort;
  onSort: (next: TraceSort) => void;
  onSelect: (trace: TraceSummaryDto) => void;
}) {
  const toggleSort = (key: TraceSortKey) => {
    if (sort.key === key) {
      onSort({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      onSort({ key, dir: "desc" });
    }
  };

  const sortGlyph = (key: TraceSortKey): IconName | null => {
    if (sort.key !== key) return null;
    return sort.dir === "asc" ? "chevron-up" : "chevron-down";
  };

  return (
    <table className="w-full border-collapse text-[12px]">
      <thead className="sticky top-0 z-[1] bg-surface-2/60 backdrop-blur-sm">
        <tr className="border-b border-border text-left">
          <th className={HEAD_CELL}>trace</th>
          <th className={HEAD_CELL}>员工</th>
          <th className={HEAD_CELL}>状态</th>
          <th className={`${HEAD_CELL} text-right`}>
            <button
              type="button"
              onClick={() => toggleSort("duration_s")}
              className={`${HEAD_BTN} ml-auto`}
              aria-label="按时长排序"
            >
              时长
              <SortGlyph name={sortGlyph("duration_s")} />
            </button>
          </th>
          <th className={`${HEAD_CELL} text-right`}>
            <button
              type="button"
              onClick={() => toggleSort("tokens")}
              className={`${HEAD_BTN} ml-auto`}
              aria-label="按 tokens 排序"
            >
              tokens
              <SortGlyph name={sortGlyph("tokens")} />
            </button>
          </th>
          <th className={HEAD_CELL}>
            <button
              type="button"
              onClick={() => toggleSort("started_at")}
              className={HEAD_BTN}
              aria-label="按开始时间排序"
            >
              开始时间
              <SortGlyph name={sortGlyph("started_at")} />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {traces.map((t) => {
          const active = t.trace_id === selectedId;
          const failed = t.status === "failed";
          return (
            <tr
              key={t.trace_id}
              role="row"
              aria-selected={active}
              tabIndex={0}
              data-active={active ? "true" : undefined}
              onClick={() => onSelect(t)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(t);
                }
              }}
              className={
                "relative cursor-pointer border-b border-border transition-colors duration-fast " +
                (active
                  ? "bg-primary-muted"
                  : "hover:bg-surface-2/40")
              }
            >
              <td className="relative py-2.5 px-3 font-mono text-[11px] truncate max-w-[220px]">
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary"
                  />
                )}
                <span className={active ? "text-primary" : "text-text-muted"}>
                  {t.trace_id}
                </span>
              </td>
              <td className="py-2.5 px-3 text-text">
                {t.employee_name ?? t.employee_id ?? "—"}
              </td>
              <td className="py-2.5 px-3">
                <span
                  className={
                    "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium " +
                    (failed
                      ? "bg-danger-soft text-danger"
                      : "bg-success-soft text-success")
                  }
                >
                  <Icon
                    name={failed ? "alert-circle" : "check-circle-2"}
                    size={11}
                  />
                  {failed ? "失败" : "成功"}
                </span>
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-[11px] text-text-muted tabular-nums">
                {formatDuration(t.duration_s)}
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-[11px] text-text-muted tabular-nums">
                {t.tokens.toLocaleString()}
              </td>
              <td className="py-2.5 px-3 font-mono text-[11px] text-text-muted">
                {formatStartedAt(t.started_at)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SortGlyph({ name }: { name: IconName | null }) {
  if (!name) {
    return <span aria-hidden className="w-3" />;
  }
  return <Icon name={name} size={12} className="text-primary" />;
}
