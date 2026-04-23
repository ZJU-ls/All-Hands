"use client";

import { Select, type SelectOption } from "@/components/ui/Select";
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

const FIELD_LABEL =
  "font-mono text-[10px] uppercase tracking-wider text-text-subtle";
const INPUT_CLS =
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

  const employeeOptions: SelectOption[] = [
    { value: "all", label: "全部" },
    ...employees.map((emp) => ({ value: emp.id, label: emp.name })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-6 py-3">
      <div className="flex items-center gap-1.5">
        <span className={FIELD_LABEL}>时间</span>
        <Select
          size="sm"
          value={filters.range}
          onChange={(v) => update({ range: v as TimeRange })}
          options={RANGE_OPTIONS}
          ariaLabel="时间范围"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span className={FIELD_LABEL}>员工</span>
        <Select
          size="sm"
          value={filters.employeeId}
          onChange={(v) => update({ employeeId: v })}
          options={employeeOptions}
          ariaLabel="员工"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span className={FIELD_LABEL}>状态</span>
        <Select
          size="sm"
          value={filters.status}
          onChange={(v) => update({ status: v as TraceStatusFilter })}
          options={STATUS_OPTIONS}
          ariaLabel="状态"
        />
      </div>

      <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
        <span className={FIELD_LABEL}>关键词</span>
        <input
          aria-label="关键词"
          type="search"
          placeholder="trace_id / 员工名"
          className={`${INPUT_CLS} w-48 placeholder:text-text-subtle`}
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
          className={`${INPUT_CLS} px-3 disabled:opacity-50`}
        >
          {busy ? "刷新中…" : "刷新"}
        </button>
      </div>
    </div>
  );
}
