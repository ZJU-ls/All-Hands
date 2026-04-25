"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
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

const STATUS_TONE: Record<TraceStatusFilter, string> = {
  all: "bg-surface-2 text-text-muted",
  ok: "bg-success-soft text-success",
  failed: "bg-danger-soft text-danger",
};

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
  "font-mono text-[10px] uppercase tracking-[0.18em] text-text-subtle";

/**
 * V2 (ADR 0016) filter bar:
 *   - Surface card (`rounded-xl border bg-surface p-4 shadow-soft-sm`).
 *   - Left: search input (with `search` icon) + time-range pill group +
 *     employee `<Select>` + status chip pills.
 *   - Right: loaded/total counter + primary refresh button.
 */
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
  const t = useTranslations("traces.filters");
  const update = (patch: Partial<TraceFilterState>) =>
    onChange({ ...filters, ...patch });

  const rangeOptions: { value: TimeRange; label: string }[] = [
    { value: "1h", label: "1h" },
    { value: "24h", label: "24h" },
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" },
    { value: "all", label: t("rangeAll") },
  ];

  const statusOptions: { value: TraceStatusFilter; label: string; tone: string }[] = [
    { value: "all", label: t("statusAll"), tone: STATUS_TONE.all },
    { value: "ok", label: t("statusOk"), tone: STATUS_TONE.ok },
    { value: "failed", label: t("statusFailed"), tone: STATUS_TONE.failed },
  ];

  const employeeOptions: SelectOption[] = [
    { value: "all", label: t("employeeAll") },
    ...employees.map((emp) => ({ value: emp.id, label: emp.name })),
  ];

  return (
    <div className="mx-6 my-4 rounded-xl border border-border bg-surface p-4 shadow-soft-sm">
      <div className="flex flex-wrap items-center gap-3">
        {/* search */}
        <label className="relative flex min-w-[200px] flex-1 items-center">
          <span className="pointer-events-none absolute left-3 text-text-subtle">
            <Icon name="search" size={14} />
          </span>
          <input
            aria-label={t("keywordAria")}
            type="search"
            placeholder={t("keywordPlaceholder")}
            value={filters.keyword}
            onChange={(e) => update({ keyword: e.target.value })}
            className="h-9 w-full rounded-md border border-border bg-surface-2 pl-9 pr-3 text-[12px] text-text placeholder:text-text-subtle transition-colors duration-fast hover:border-border-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:border-primary"
          />
        </label>

        {/* time-range pills */}
        <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 p-0.5">
          {rangeOptions.map((o) => {
            const active = filters.range === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => update({ range: o.value })}
                aria-pressed={active}
                className={
                  "h-7 rounded-sm px-2.5 text-[11px] font-medium transition-colors duration-fast " +
                  (active
                    ? "bg-surface text-primary shadow-soft-sm"
                    : "text-text-muted hover:text-text")
                }
              >
                {o.label}
              </button>
            );
          })}
        </div>

        {/* employee select */}
        <Select
          size="sm"
          value={filters.employeeId}
          onChange={(v) => update({ employeeId: v })}
          options={employeeOptions}
          ariaLabel={t("employeeAria")}
        />

        {/* status chips */}
        <div className="flex items-center gap-1.5">
          <span className={FIELD_LABEL}>{t("statusLabel")}</span>
          {statusOptions.map((o) => {
            const active = filters.status === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => update({ status: o.value })}
                aria-pressed={active}
                className={
                  "inline-flex h-7 items-center rounded-sm px-2 text-[11px] font-medium transition-colors duration-fast " +
                  (active
                    ? o.tone
                    : "bg-surface-2 text-text-subtle hover:bg-surface-3 hover:text-text")
                }
              >
                {o.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[10px] tabular-nums text-text-subtle">
            {loadedCount === totalCount
              ? t("countTotal", { count: totalCount })
              : t("countLoaded", { loaded: loadedCount, total: totalCount })}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            aria-label={t("refreshAria")}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-medium text-text transition-colors duration-fast hover:border-border-strong hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon
              name="refresh"
              size={12}
              className={busy ? "animate-spin" : undefined}
            />
            {busy ? t("refreshing") : t("refresh")}
          </button>
        </div>
      </div>
    </div>
  );
}
