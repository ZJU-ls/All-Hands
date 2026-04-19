"use client";

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
  // Fixed locale so the column width is predictable.
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const HEAD_BTN_CLS =
  "flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider " +
  "font-medium text-text-subtle transition-colors duration-base hover:text-text";

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

  const arrow = (key: TraceSortKey): string => {
    if (sort.key !== key) return "";
    return sort.dir === "asc" ? "↑" : "↓";
  };

  return (
    <table className="w-full border-collapse text-[12px]">
      <thead className="sticky top-0 z-[1] bg-surface">
        <tr className="border-b border-border text-left">
          <th className="py-2 px-4 font-mono text-[10px] uppercase tracking-wider font-medium text-text-subtle">
            trace
          </th>
          <th className="py-2 pr-4 font-mono text-[10px] uppercase tracking-wider font-medium text-text-subtle">
            员工
          </th>
          <th className="py-2 pr-4 font-mono text-[10px] uppercase tracking-wider font-medium text-text-subtle">
            状态
          </th>
          <th className="py-2 pr-4 text-right">
            <button
              type="button"
              onClick={() => toggleSort("duration_s")}
              className={`${HEAD_BTN_CLS} ml-auto`}
              aria-label="按时长排序"
            >
              时长 <span className="font-mono">{arrow("duration_s")}</span>
            </button>
          </th>
          <th className="py-2 pr-4 text-right">
            <button
              type="button"
              onClick={() => toggleSort("tokens")}
              className={`${HEAD_BTN_CLS} ml-auto`}
              aria-label="按 tokens 排序"
            >
              tokens <span className="font-mono">{arrow("tokens")}</span>
            </button>
          </th>
          <th className="py-2 pr-4">
            <button
              type="button"
              onClick={() => toggleSort("started_at")}
              className={HEAD_BTN_CLS}
              aria-label="按开始时间排序"
            >
              开始时间 <span className="font-mono">{arrow("started_at")}</span>
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {traces.map((t) => {
          const active = t.trace_id === selectedId;
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
              className={`cursor-pointer border-b border-border transition-colors duration-base ${
                active ? "bg-surface-2" : "hover:bg-surface-2"
              }`}
            >
              <td className="py-2 px-4 font-mono text-[11px] text-text-muted truncate max-w-[200px]">
                {t.trace_id}
              </td>
              <td className="py-2 pr-4 text-text">
                {t.employee_name ?? t.employee_id ?? "—"}
              </td>
              <td className="py-2 pr-4">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      t.status === "failed" ? "bg-danger" : "bg-success"
                    }`}
                  />
                  <span
                    className={
                      t.status === "failed" ? "text-danger" : "text-text-muted"
                    }
                  >
                    {t.status === "failed" ? "失败" : "成功"}
                  </span>
                </span>
              </td>
              <td className="py-2 pr-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                {formatDuration(t.duration_s)}
              </td>
              <td className="py-2 pr-4 text-right font-mono text-[11px] text-text-muted tabular-nums">
                {t.tokens.toLocaleString()}
              </td>
              <td className="py-2 pr-4 font-mono text-[11px] text-text-muted">
                {formatStartedAt(t.started_at)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
