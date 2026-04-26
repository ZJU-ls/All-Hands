"use client";

import { useLocale, useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/Skeleton";
import type { TraceSummaryDto } from "@/lib/observatory-api";

/**
 * Skeleton row stack for the trace table loading state. Matches the table's
 * column proportions so layout doesn't jump on first paint of real data.
 * `rows` defaults to 6 — enough to fill the viewport without overflowing.
 */
export function TraceTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      aria-hidden
      data-testid="trace-table-skeleton"
      className="divide-y divide-border"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-3 py-3"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <Skeleton className="h-3 w-[180px]" />
          <Skeleton className="h-3 w-[120px]" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <div className="flex-1" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

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

function formatStartedAt(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, {
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
      av = a.tokens.total;
      bv = b.tokens.total;
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
  const t = useTranslations("traces.table");
  const locale = useLocale();
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
          <th className={HEAD_CELL}>{t("trace")}</th>
          <th className={HEAD_CELL}>{t("employee")}</th>
          <th className={HEAD_CELL}>{t("status")}</th>
          <th className={`${HEAD_CELL} text-right`}>
            <button
              type="button"
              onClick={() => toggleSort("duration_s")}
              className={`${HEAD_BTN} ml-auto`}
              aria-label={t("sortDuration")}
            >
              {t("duration")}
              <SortGlyph name={sortGlyph("duration_s")} />
            </button>
          </th>
          <th className={`${HEAD_CELL} text-right`}>
            <button
              type="button"
              onClick={() => toggleSort("tokens")}
              className={`${HEAD_BTN} ml-auto`}
              aria-label={t("sortTokens")}
            >
              {t("tokens")}
              <SortGlyph name={sortGlyph("tokens")} />
            </button>
          </th>
          <th className={HEAD_CELL}>
            <button
              type="button"
              onClick={() => toggleSort("started_at")}
              className={HEAD_BTN}
              aria-label={t("sortStartedAt")}
            >
              {t("startedAt")}
              <SortGlyph name={sortGlyph("started_at")} />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {traces.map((row) => {
          const active = row.trace_id === selectedId;
          const failed = row.status === "failed";
          const running = row.status === "running";
          return (
            <tr
              key={row.trace_id}
              role="row"
              aria-selected={active}
              tabIndex={0}
              data-active={active ? "true" : undefined}
              onClick={() => onSelect(row)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(row);
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
                  {row.trace_id}
                </span>
              </td>
              <td className="py-2.5 px-3 text-text">
                {row.employee_name ?? row.employee_id ?? t("fallback")}
              </td>
              <td className="py-2.5 px-3">
                <span
                  className={
                    "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium " +
                    (failed
                      ? "bg-danger-soft text-danger"
                      : running
                        ? "bg-warning-soft text-warning"
                        : "bg-success-soft text-success")
                  }
                >
                  <Icon
                    name={failed ? "alert-circle" : running ? "loader" : "check-circle-2"}
                    size={11}
                    className={running ? "animate-spin-slow" : undefined}
                  />
                  {failed ? t("failed") : running ? t("running") : t("ok")}
                </span>
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-[11px] text-text-muted tabular-nums">
                {formatDuration(row.duration_s)}
              </td>
              <td
                className="py-2.5 px-3 text-right font-mono text-[11px] text-text-muted tabular-nums"
                title={
                  row.tokens.total > 0
                    ? `in ${row.tokens.prompt.toLocaleString(locale)} · out ${row.tokens.completion.toLocaleString(locale)} · total ${row.tokens.total.toLocaleString(locale)}`
                    : undefined
                }
              >
                {row.tokens.total > 0 ? row.tokens.total.toLocaleString(locale) : "—"}
              </td>
              <td className="py-2.5 px-3 font-mono text-[11px] text-text-muted">
                {formatStartedAt(row.started_at, locale)}
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
