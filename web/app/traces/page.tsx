"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
import { Icon } from "@/components/ui/icon";
import {
  fetchTraces,
  type TraceSummaryDto,
} from "@/lib/observatory-api";
import { listEmployees, type EmployeeDto } from "@/lib/api";
import {
  DEFAULT_FILTERS,
  TraceFilters,
  rangeToSinceISO,
  type TraceFilterState,
} from "@/components/traces/TraceFilters";
import {
  DEFAULT_SORT,
  TraceTable,
  sortTraces,
  type TraceSort,
} from "@/components/traces/TraceTable";
import { TRACE_QUERY_KEY } from "@/components/runs/TraceChip";

const PAGE_SIZE = 50;

type LoadState = "loading" | "ok" | "error";

function dedupe(traces: TraceSummaryDto[]): TraceSummaryDto[] {
  const seen = new Set<string>();
  const out: TraceSummaryDto[] = [];
  for (const t of traces) {
    if (seen.has(t.trace_id)) continue;
    seen.add(t.trace_id);
    out.push(t);
  }
  return out;
}

function applyFilters(
  traces: TraceSummaryDto[],
  filters: TraceFilterState,
): TraceSummaryDto[] {
  const kw = filters.keyword.trim().toLowerCase();
  if (!kw) return traces;
  return traces.filter((t) => {
    const employee = (t.employee_name ?? t.employee_id ?? "").toLowerCase();
    return t.trace_id.toLowerCase().includes(kw) || employee.includes(kw);
  });
}

export default function TracesPage() {
  // Next.js 15 requires every `useSearchParams` consumer to sit inside a
  // Suspense boundary (E03). Wrap the inner body so SSR can fall back to the
  // list skeleton while the client hydrates the URL state.
  const t = useTranslations("traces.page");
  return (
    <Suspense
      fallback={
        <AppShell title={t("title")}>
          <div className="flex-1 px-6 py-4">
            <LoadingState title={t("loadingList")} />
          </div>
        </AppShell>
      }
    >
      <TracesPageInner />
    </Suspense>
  );
}

function TracesPageInner() {
  const t = useTranslations("traces.page");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams?.get(TRACE_QUERY_KEY) ?? null;

  const [filters, setFilters] = useState<TraceFilterState>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<TraceSort>(DEFAULT_SORT);
  const [traces, setTraces] = useState<TraceSummaryDto[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeDto[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const openTrace = useCallback(
    (runId: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set(TRACE_QUERY_KEY, runId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const load = useCallback(async (next: TraceFilterState) => {
    setState("loading");
    setError(null);
    try {
      const since = rangeToSinceISO(next.range);
      const [page, emps] = await Promise.all([
        fetchTraces({
          employee_id: next.employeeId === "all" ? undefined : next.employeeId,
          status: next.status === "all" ? undefined : next.status,
          since,
          limit: PAGE_SIZE,
        }),
        listEmployees().catch(() => [] as EmployeeDto[]),
      ]);
      setTraces(dedupe(page.traces));
      setTotalCount(page.count);
      setHasMore(page.traces.length >= PAGE_SIZE);
      setEmployees(emps);
      setState("ok");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load(filters);
    // re-run whenever the API-relevant filters change. Keyword is client-side
    // only so it does not appear in the dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.range, filters.employeeId, filters.status, load]);

  const onLoadMore = useCallback(async () => {
    if (loadingMore || traces.length === 0) return;
    setLoadingMore(true);
    try {
      const since = rangeToSinceISO(filters.range);
      const oldest = traces.reduce(
        (acc, t) => (acc === null || t.started_at < acc ? t.started_at : acc),
        null as string | null,
      );
      const page = await fetchTraces({
        employee_id: filters.employeeId === "all" ? undefined : filters.employeeId,
        status: filters.status === "all" ? undefined : filters.status,
        since,
        until: oldest ?? undefined,
        limit: PAGE_SIZE,
      });
      setTraces((prev) => dedupe(prev.concat(page.traces)));
      setTotalCount((prev) => Math.max(prev, page.count));
      setHasMore(page.traces.length >= PAGE_SIZE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [filters, loadingMore, traces]);

  const visible = useMemo(
    () => sortTraces(applyFilters(traces, filters), sort),
    [traces, filters, sort],
  );

  return (
    <AppShell title={t("title")}>
      <div className="flex h-full min-h-0">
        <div className="flex flex-1 flex-col min-w-0">
          <TraceFilters
            filters={filters}
            employees={employees}
            totalCount={totalCount}
            loadedCount={traces.length}
            busy={state === "loading"}
            onChange={setFilters}
            onRefresh={() => void load(filters)}
          />
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {state === "loading" && traces.length === 0 ? (
              <LoadingState
                title={t("loadingList")}
                description={t("loadingDescription")}
              />
            ) : state === "error" && traces.length === 0 ? (
              <ErrorState
                title={t("errorTitle")}
                detail={error ?? undefined}
                action={{ label: tCommon("retry"), onClick: () => void load(filters) }}
              />
            ) : visible.length === 0 ? (
              <EmptyState
                title={t("emptyTitle")}
                description={t("emptyDescription")}
                action={{
                  label: t("resetFilters"),
                  onClick: () => setFilters(DEFAULT_FILTERS),
                }}
              />
            ) : (
              <>
                <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-soft-sm">
                  <TraceTable
                    traces={visible}
                    selectedId={selectedId}
                    sort={sort}
                    onSort={setSort}
                    onSelect={(t) => openTrace(t.trace_id)}
                  />
                </div>
                <div className="mt-4 flex items-center justify-center gap-3 text-caption font-mono text-text-subtle">
                  {hasMore ? (
                    <button
                      type="button"
                      onClick={() => void onLoadMore()}
                      disabled={loadingMore}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-text shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
                    >
                      <Icon
                        name={loadingMore ? "loader" : "chevron-down"}
                        size={12}
                        className={loadingMore ? "animate-spin-slow" : ""}
                      />
                      <span>{loadingMore ? t("loading") : t("loadMore")}</span>
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="check" size={11} className="text-success" />
                      {t("endReached", { count: traces.length })}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
