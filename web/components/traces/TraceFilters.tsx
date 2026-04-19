"use client";

import type { EmployeeDto } from "@/lib/api";

export type TimeRange = "1h" | "24h" | "7d" | "30d" | "all";
export type TraceStatusFilter = "all" | "ok" | "failed";

export type TraceFilterState = {
  range: TimeRange;
  employeeId: string | "all";
  status: TraceStatusFilter;
  keyword: string;
};

export const DEFAULT_FILTERS: TraceFilterState = {
  range: "24h",
  employeeId: "all",
  status: "all",
  keyword: "",
};

const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "1 小时" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "all", label: "全部" },
];

const STATUS_OPTIONS: { value: TraceStatusFilter; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "ok", label: "成功" },
  { value: "failed", label: "失败" },
];

export function rangeToSinceISO(range: TimeRange, now: Date = new Date()): string | undefined {
  if (range === "all") return undefined;
  const ms: Record<Exclude<TimeRange, "all">, number> = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(now.getTime() - ms[range]).toISOString();
}

const SELECT_CLS =
  "h-7 rounded-md border border-border bg-surface px-2 text-[12px] text-text " +
  "transition-colors duration-base hover:border-border-strong " +
  "focus:outline-none focus:border-border-strong";

export function TraceFilters({
  filters,
  employees,
  totalCount,
  loadedCount,
  busy,
  onChange,
  onRefresh,
}: {
  filters: TraceFilterState;
  employees: EmployeeDto[];
  totalCount: number;
  loadedCount: number;
  busy: boolean;
  onChange: (next: TraceFilterState) => void;
  onRefresh: () => void;
}) {
  const update = (patch: Partial<TraceFilterState>) =>
    onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-6 py-3">
      <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
          时间
        </span>
        <select
          aria-label="时间范围"
          className={SELECT_CLS}
          value={filters.range}
          onChange={(e) => update({ range: e.target.value as TimeRange })}
        >
          {RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
          员工
        </span>
        <select
          aria-label="员工"
          className={SELECT_CLS}
          value={filters.employeeId}
          onChange={(e) => update({ employeeId: e.target.value })}
        >
          <option value="all">全部</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
          状态
        </span>
        <select
          aria-label="状态"
          className={SELECT_CLS}
          value={filters.status}
          onChange={(e) =>
            update({ status: e.target.value as TraceStatusFilter })
          }
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
          关键词
        </span>
        <input
          aria-label="关键词"
          type="search"
          placeholder="trace_id / 员工名"
          className={`${SELECT_CLS} w-48 placeholder:text-text-subtle`}
          value={filters.keyword}
          onChange={(e) => update({ keyword: e.target.value })}
        />
      </label>

      <div className="ml-auto flex items-center gap-3">
        <span className="font-mono text-[10px] tabular-nums text-text-subtle">
          {loadedCount === totalCount
            ? `${totalCount} 条`
            : `${loadedCount} / ${totalCount}`}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          className="h-7 rounded-md border border-border bg-surface px-3 text-[12px] text-text transition-colors duration-base hover:border-border-strong disabled:opacity-50"
        >
          {busy ? "刷新中…" : "刷新"}
        </button>
      </div>
    </div>
  );
}
