"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
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
  return (
    <Suspense
      fallback={
        <AppShell title="追踪">
          <div className="flex-1 px-6 py-4">
            <LoadingState title="加载追踪列表" />
          </div>
        </AppShell>
      }
    >
      <TracesPageInner />
    </Suspense>
  );
}

function TracesPageInner() {
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
    <AppShell title="追踪">
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
                title="加载追踪列表"
                description="正在拉取最近的 trace 摘要"
              />
            ) : state === "error" && traces.length === 0 ? (
              <ErrorState
                title="追踪列表加载失败"
                detail={error ?? undefined}
                action={{ label: "重试", onClick: () => void load(filters) }}
              />
            ) : visible.length === 0 ? (
              <EmptyState
                title="当前过滤下没有 trace"
                description="调整时间范围或关键词,或先和员工开一次对话生成 run 事件。"
                action={{
                  label: "重置过滤",
                  onClick: () => setFilters(DEFAULT_FILTERS),
                }}
              />
            ) : (
              <>
                <div className="rounded-md border border-border bg-surface overflow-hidden">
                  <TraceTable
                    traces={visible}
                    selectedId={selectedId}
                    sort={sort}
                    onSort={setSort}
                    onSelect={(t) => openTrace(t.trace_id)}
                  />
                </div>
                <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-text-muted">
                  {hasMore ? (
                    <button
                      type="button"
                      onClick={() => void onLoadMore()}
                      disabled={loadingMore}
                      className="h-7 rounded-md border border-border bg-surface px-3 text-[12px] text-text transition-colors duration-base hover:border-border-strong disabled:opacity-50"
                    >
                      {loadingMore ? "加载中…" : "加载更多"}
                    </button>
                  ) : (
                    <span className="font-mono text-[10px] text-text-subtle">
                      · 已到末尾
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
