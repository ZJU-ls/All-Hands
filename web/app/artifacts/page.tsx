"use client";

/**
 * Global /artifacts page · workspace-wide catalog with stats strip + filter
 * row (token-styled <Select> · no native dropdown chrome) + 2-pane list +
 * detail. Stats refresh on mount and after any artifact_changed SSE frame
 * (create / update / delete / pin), so KPIs reflect what the user sees in
 * the list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { Icon, type IconName } from "@/components/ui/icon";
import { Select } from "@/components/ui/Select";
import { ErrorState } from "@/components/state";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ArtifactList } from "@/components/artifacts/ArtifactList";
import { ArtifactGrid } from "@/components/artifacts/ArtifactGrid";
import { ArtifactDetail } from "@/components/artifacts/ArtifactDetail";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import {
  artifactStreamUrl,
  deleteArtifact,
  getArtifactStats,
  listArtifacts,
  pinArtifact,
  type ArtifactDto,
  type ArtifactKind,
  type ArtifactSort,
  type ArtifactStatsDto,
} from "@/lib/artifacts-api";
import { useEmployeeNames } from "@/lib/use-employee-names";

// 2026-04-27 · KINDS array必须含全部 12 种(对齐 backend ArtifactKind enum)。
// 之前只有 7 项 · 用户从顶部 stats 卡点 "csv · 2" 时,过滤面包屑显示 csv,
// 但 ArtifactList 的 KIND_ORDER 也漏 csv → 整列分组 fallback 不渲染 →
// 屏空。补全 + 把 csv/xlsx/docx/pdf/pptx 在 office 类别下单独排,不再
// 与"其他"混。
const KINDS: ArtifactKind[] = [
  "markdown",
  "code",
  "html",
  "image",
  "data",
  "mermaid",
  "drawio",
  "csv",
  "xlsx",
  "docx",
  "pdf",
  "pptx",
];

const SORTS: ArtifactSort[] = [
  "updated_at_desc",
  "created_at_desc",
  "created_at_asc",
  "name_asc",
  "name_desc",
  "size_desc",
];

// 2026-04-27 · video 已从 ArtifactKind 删除(对齐 backend enum)。
// office 三件套(csv/xlsx)用 table 图标替代 database,语义更精确。
const KIND_ICON: Record<ArtifactKind, IconName> = {
  markdown: "file",
  code: "code",
  html: "code",
  image: "eye",
  data: "database",
  mermaid: "activity",
  drawio: "layout-grid",
  pptx: "file",
  csv: "table",
  xlsx: "table",
  docx: "file-text",
  pdf: "file",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

type DateRange = "all" | "7d" | "30d";

export default function ArtifactsGlobalPage() {
  const t = useTranslations("artifacts.page");
  const tToast = useTranslations("artifacts.page.bulk.toast");
  const [items, setItems] = useState<ArtifactDto[]>([]);
  const [stats, setStats] = useState<ArtifactStatsDto | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [kind, setKind] = useState<ArtifactKind | "">("");
  const [sort, setSort] = useState<ArtifactSort>("updated_at_desc");
  const [q, setQ] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>("all");
  // localStorage-backed view mode · sticks across page visits so the user's
  // preferred density stays put. SSR-safe: lazy initial.
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    return (localStorage.getItem("allhands.artifacts.viewMode") as "list" | "grid" | null) ?? "list";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("allhands.artifacts.viewMode", viewMode);
    }
  }, [viewMode]);

  const createdAfter = useMemo(() => {
    if (dateRange === "all") return undefined;
    const days = dateRange === "7d" ? 7 : 30;
    return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  }, [dateRange]);

  const hasActiveFilters =
    Boolean(q) || Boolean(kind) || pinnedOnly || dateRange !== "all";

  function clearAllFilters() {
    setQ("");
    setKind("");
    setPinnedOnly(false);
    setDateRange("all");
  }

  // Bulk-selection set · disjoint from `selectedId` (the singular detail
  // pane focus). Cmd/Ctrl+click on a list/grid item toggles its membership.
  // Once non-empty, the floating BulkActionBar appears with pin/delete.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const toast = useToast();

  function toggleBulk(id: string) {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearBulk() {
    setBulkSelected(new Set());
  }

  // Resolve "are all currently bulk-selected items pinned?" to decide the
  // pin/unpin label. If mixed, default to pin (most common intent).
  const allPinned =
    bulkSelected.size > 0 &&
    items.filter((a) => bulkSelected.has(a.id)).every((a) => a.pinned);

  async function bulkPin() {
    if (bulkSelected.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    const targetPinned = !allPinned;
    const targetIds = Array.from(bulkSelected);
    // Optimistic flip · the list reflects the new pinned state instantly,
    // SSE follow-up just confirms. If a request fails, we revert that one
    // row + raise an error toast.
    setItems((prev) =>
      prev.map((a) => (bulkSelected.has(a.id) ? { ...a, pinned: targetPinned } : a)),
    );
    let failed = 0;
    try {
      for (const id of targetIds) {
        try {
          await pinArtifact(id, targetPinned);
        } catch {
          failed += 1;
          // Revert just this row.
          setItems((prev) =>
            prev.map((a) => (a.id === id ? { ...a, pinned: !targetPinned } : a)),
          );
        }
      }
      if (failed === 0) {
        toast.success(
          tToast(targetPinned ? "pinned" : "unpinned", { n: targetIds.length }),
        );
      } else {
        toast.error(
          tToast("pinPartial", { ok: failed, total: targetIds.length }),
          tToast("pinPartialDesc"),
        );
      }
    } finally {
      setBulkBusy(false);
    }
  }
  // Two-step delete · the BulkActionBar's Delete button now opens the
  // branded ConfirmDialog (instead of native window.confirm which can't
  // honor §3.8 visual contract or our keyboard semantics).
  function bulkDeleteRequest() {
    if (bulkSelected.size === 0 || bulkBusy) return;
    setBulkDeleteConfirm(true);
  }
  async function bulkDeleteConfirmed() {
    setBulkDeleteConfirm(false);
    if (bulkSelected.size === 0) return;
    setBulkBusy(true);
    const targetCount = bulkSelected.size;
    let failed = 0;
    try {
      for (const id of bulkSelected) {
        try {
          await deleteArtifact(id);
        } catch {
          failed += 1;
        }
      }
      clearBulk();
      if (failed === 0) {
        toast.success(
          tToast("deletedAll", { n: targetCount }),
          tToast("deletedAllDesc"),
        );
      } else if (failed < targetCount) {
        toast.warning(tToast("deletedPartial", { ok: targetCount - failed, failed }));
      } else {
        toast.error(tToast("deletedNone", { n: failed }));
      }
    } finally {
      setBulkBusy(false);
    }
  }

  // Keyboard navigation · j/k (or ↓/↑) move selection through the visible
  // list, Enter is a no-op since selecting already opens detail (the right
  // pane subscribes to selectedId), / focuses the search input, Esc clears
  // search when focused or otherwise drops selection. Same shortcuts that
  // power Linear's issue list / GitHub's PR list — keyboard-first users
  // get full coverage without touching the mouse.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      // `/` focuses search · always honored, even from inside other inputs
      // would be too invasive · skip when already typing somewhere.
      if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      // Esc · if search is focused, blur + clear; else drop selection.
      if (e.key === "Escape") {
        if (document.activeElement === searchInputRef.current) {
          if (q) setQ("");
          else searchInputRef.current?.blur();
        } else if (selectedId) {
          setSelectedId(null);
        }
        return;
      }
      // j/k or arrow up/down · skip when typing.
      if (isTypingTarget(e.target)) return;
      const isDown = e.key === "j" || e.key === "ArrowDown";
      const isUp = e.key === "k" || e.key === "ArrowUp";
      if (!isDown && !isUp) return;
      if (items.length === 0) return;
      e.preventDefault();
      const currentIdx = selectedId
        ? items.findIndex((a) => a.id === selectedId)
        : -1;
      const nextIdx = isDown
        ? Math.min(items.length - 1, currentIdx + 1)
        : Math.max(0, currentIdx - 1);
      const next = items[nextIdx === -1 ? 0 : nextIdx];
      if (next) setSelectedId(next.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selectedId, q]);

  // 2026-04-27 · 把 fetchList 抽出来,SSE artifact_changed 也能复用
  // 同一份"用当前 filter 重拉列表"的逻辑。否则 backend 创建/删除/
  // pin 后,顶部 stats 跳了但列表还是旧的 — count chip 与 list 失同步。
  // useRef(filters) 的可读副本让 fetchList 不需要 deps:effect 触发会
  // 重设 ref;SSE handler 调用时永远拿最新 filter。
  const filtersRef = useRef({
    kind: kind as ArtifactKind | "",
    sort,
    q,
    pinnedOnly,
    createdAfter,
  });
  filtersRef.current = { kind, sort, q, pinnedOnly, createdAfter };

  const fetchList = useCallback(async () => {
    const f = filtersRef.current;
    return listArtifacts({
      kind: f.kind || undefined,
      q: f.q || undefined,
      sort: f.sort,
      pinned: f.pinnedOnly || undefined,
      createdAfter: f.createdAfter,
      limit: 200,
    });
  }, []);

  // 2026-04-27 · 搜索 debounce 250ms。原实现每次按键都打一发 200-item
  // 的 list 请求,即便 cancelled flag 防止了 stale write,backend 也吃了
  // 一串无效请求(快速键入 6 个字符 → 6 个 query)。debouncedQ 让 effect
  // 只在键入暂停 250ms 后才触发刷新。其他 filter(kind/sort/pinned/
  // dateRange)是离散选择,不需要 debounce — 立即生效。
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    if (q === debouncedQ) return;
    const id = window.setTimeout(() => setDebouncedQ(q), 250);
    return () => window.clearTimeout(id);
  }, [q, debouncedQ]);

  // Refetch list when filters move. With debouncedQ, search keystrokes
  // collapse to one query per pause;離散 filter 立即生效。
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    void (async () => {
      try {
        const next = await fetchList();
        if (!cancelled) {
          setItems(next);
          setState("ok");
          setError(null);
          // 2026-04-27 · selectedId 自洽回收。filter 切换后 next 里如果不
          // 包含原 selectedId,详情面板会继续显示旧制品(filter csv 但
          // 看到 drawio),违反"右侧永远是当前可见列表中的项"约束。
          // 用 setSelectedId 函数式取值避免把 selectedId 加进 deps · 再
          // 触发本 effect 的死循环。
          setSelectedId((cur) => {
            if (cur === null) return cur;
            return next.some((a) => a.id === cur) ? cur : null;
          });
          // 同步:bulkSelected 里凡是不在新 list 里的也清掉。bulk 是隐式
          // 状态(用户看不见),漂移到不可见项更危险(批量删时把"看不
          // 见但勾选了"的也删掉)。
          setBulkSelected((cur) => {
            if (cur.size === 0) return cur;
            const visibleIds = new Set(next.map((a) => a.id));
            const filtered = new Set<string>();
            for (const id of cur) if (visibleIds.has(id)) filtered.add(id);
            return filtered.size === cur.size ? cur : filtered;
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // debouncedQ 取代 q · fetchList 通过 filtersRef 读 q,但 effect 触发
    // 节奏看 debouncedQ。filtersRef.current = { ..., q } 在每次 render 重
    // 设,所以 fetchList 拿到的永远是最新 q —— debounce 只控发请求频率。
  }, [kind, sort, debouncedQ, pinnedOnly, createdAfter, fetchList]);

  // Stats are filter-independent · they describe the whole workspace, not
  // the current view. Pull once on mount + on artifact_changed SSE so the
  // KPIs stay live without polling.
  const refreshStats = useCallback(async () => {
    try {
      const s = await getArtifactStats();
      setStats(s);
    } catch {
      // Stats are best-effort · the page still renders without them.
    }
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    const es = new EventSource(artifactStreamUrl());
    // 2026-04-27 · 之前只刷 stats,导致列表与统计失同步:agent 在后台
    // 创建一个新 csv,顶部 stats 立刻 +1,但 sidebar 列表里看不到。
    // 现在同步 refresh list,配合 fetchList 用 filtersRef 不依赖 deps,
    // 任何时刻调用都拿最新 filter 拉数据。
    let busy = false;
    const onChanged = async () => {
      if (busy) return; // 简单的 inflight 防抖,避免 burst create 时连发
      busy = true;
      try {
        // 并发刷新 stats 与 list — 它们独立查 backend,串行一遍意义不大
        await Promise.all([
          refreshStats(),
          fetchList()
            .then((next) => {
              setItems(next);
              // selectedId 自洽:SSE 后被删的项要从详情面板回收
              setSelectedId((cur) =>
                cur === null
                  ? cur
                  : next.some((a) => a.id === cur)
                    ? cur
                    : null,
              );
              setBulkSelected((cur) => {
                if (cur.size === 0) return cur;
                const visibleIds = new Set(next.map((a) => a.id));
                const filtered = new Set<string>();
                for (const id of cur) if (visibleIds.has(id)) filtered.add(id);
                return filtered.size === cur.size ? cur : filtered;
              });
            })
            .catch(() => {
              /* SSE-driven refresh 失败时静默 · 不要遮罩当前列表 */
            }),
        ]);
      } finally {
        busy = false;
      }
    };
    es.addEventListener("artifact_changed", () => void onChanged());
    return () => {
      es.removeEventListener("artifact_changed", () => void onChanged());
      es.close();
    };
  }, [refreshStats, fetchList]);

  const kindOptions = useMemo(
    () => [
      { value: "", label: t("allKinds") },
      ...KINDS.map((k) => ({ value: k, label: k })),
    ],
    [t],
  );
  const sortOptions = useMemo(
    () => SORTS.map((s) => ({ value: s, label: t(`sort.${s}`) })),
    [t],
  );

  return (
    <AppShell>
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-6">
        <Hero
          stats={stats}
          title={t("title")}
          subtitle={t("subtitle")}
          t={t}
          activeKind={kind}
          onPickKind={(k) => setKind(k === kind ? "" : k)}
        />

        {/* Sticky toolbar · filter row + active-chip strip in one band that
            sticks at top while scrolling so search/filters stay reachable
            after the hero scrolls away. The `-mx-6 px-6` extends the band
            edge-to-edge under the page padding; backdrop-blur softens the
            content scrolling underneath. z-10 keeps it above chart fills. */}
        <div className="sticky top-0 z-10 -mx-3 border-y border-border bg-bg/80 px-3 py-2 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
            />
            <input
              ref={searchInputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search")}
              className="h-9 w-full rounded-xl border border-border bg-surface pl-9 pr-12 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
            />
            {!q ? (
              <kbd
                aria-hidden
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-subtle"
              >
                {t("kbd.search")}
              </kbd>
            ) : null}
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label={t("clearSearchAria")}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded text-text-subtle hover:text-text-muted"
              >
                <Icon name="x" size={11} />
              </button>
            ) : null}
          </div>

          <Select
            value={kind}
            onChange={(v) => setKind(v as ArtifactKind | "")}
            options={kindOptions}
            ariaLabel={t("allKinds")}
            triggerClassName="h-9 rounded-xl"
          />

          <Select
            value={sort}
            onChange={(v) => setSort(v as ArtifactSort)}
            options={sortOptions}
            ariaLabel={t("sort.updated_at_desc")}
            triggerClassName="h-9 rounded-xl"
          />

          {/* Date range · 3-segment pill (saves vertical space vs another Select) */}
          <DateRangePill value={dateRange} onChange={setDateRange} t={t} />

          {/* Pinned-only toggle · single-character primary chip when active */}
          <button
            type="button"
            onClick={() => setPinnedOnly((v) => !v)}
            aria-pressed={pinnedOnly}
            title={t("filters.pinnedOnly")}
            className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12px] transition-colors duration-fast ${
              pinnedOnly
                ? "border-primary/40 bg-primary-muted text-primary"
                : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text"
            }`}
          >
            <Icon name="check" size={12} />
            {t("filters.pinnedOnly")}
          </button>

          {/* List / grid view toggle · localStorage-backed so the user's
              density preference sticks across visits. */}
          <div className="ml-auto inline-flex h-9 items-center rounded-xl border border-border bg-surface p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
              aria-label={t("view.listAria")}
              title={t("view.list")}
              className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] transition-colors duration-fast ${
                viewMode === "list"
                  ? "bg-primary-muted text-primary"
                  : "text-text-muted hover:text-text"
              }`}
            >
              <Icon name="list" size={12} />
              <span className="hidden md:inline">{t("view.list")}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              aria-pressed={viewMode === "grid"}
              aria-label={t("view.gridAria")}
              title={t("view.grid")}
              className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] transition-colors duration-fast ${
                viewMode === "grid"
                  ? "bg-primary-muted text-primary"
                  : "text-text-muted hover:text-text"
              }`}
            >
              <Icon name="layout-grid" size={12} />
              <span className="hidden md:inline">{t("view.grid")}</span>
            </button>
          </div>

          <span className="hidden font-mono text-[11px] text-text-subtle md:inline">
            {t("kbd.navHint")}
          </span>
          <span className="font-mono text-[11px] text-text-subtle">
            {t("count", { n: items.length })}
          </span>
        </div>

        {/* Active filter chip strip · removable individual chips + clear-all
            button. Only renders when at least one filter is active. Lives
            inside the sticky toolbar so chips stay glued under the filter
            row even after scrolling. */}
        {hasActiveFilters ? (
          <div className="mt-2">
            <ActiveFilterChips
              t={t}
              q={q}
              kind={kind}
              pinnedOnly={pinnedOnly}
              dateRange={dateRange}
              onClearQ={() => setQ("")}
              onClearKind={() => setKind("")}
              onClearPinned={() => setPinnedOnly(false)}
              onClearDate={() => setDateRange("all")}
              onClearAll={clearAllFilters}
            />
          </div>
        ) : null}
        </div>

        {/* List + detail · proportions vary by view mode:
              · list  · sidebar 4/12  · detail 8/12   (dense)
              · grid  · gallery 8/12  · detail 4/12   (gallery-first)
                  if nothing selected, gallery takes all 12 cols */}
        <div className="grid min-h-[60vh] flex-1 grid-cols-12 gap-3 sm:gap-4">
          <aside
            className={
              viewMode === "list"
                ? "col-span-12 overflow-y-auto rounded-xl border border-border bg-surface lg:col-span-4 xl:col-span-3"
                : selectedId
                ? "col-span-12 overflow-y-auto rounded-xl border border-border bg-surface lg:col-span-8"
                : "col-span-12 overflow-y-auto rounded-xl border border-border bg-surface"
            }
          >
            {state === "loading" ? (
              // Skeleton matches the view mode so the layout doesn't pop
              // when results land — list rows for list view, card grid
              // for grid view. Reference: Vercel deployments / GitHub
              // Files use shape-of-final-content skeletons.
              <SkeletonList viewMode={viewMode} />
            ) : state === "error" && error ? (
              <ErrorState title={t("loadFailed", { error })} />
            ) : items.length === 0 ? (
              <EmptyList q={q} kind={kind} hasActiveFilters={hasActiveFilters} onClearAll={clearAllFilters} t={t} />
            ) : viewMode === "grid" ? (
              <ArtifactGrid
                artifacts={items}
                selectedId={selectedId}
                bulkSelected={bulkSelected}
                onSelect={setSelectedId}
                onToggleBulk={toggleBulk}
              />
            ) : (
              <ArtifactList
                artifacts={items}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </aside>

          {(viewMode === "list" || selectedId) && (
            <main
              className={
                viewMode === "list"
                  ? "col-span-12 overflow-hidden rounded-xl border border-border bg-surface lg:col-span-8 xl:col-span-9"
                  : "col-span-12 overflow-hidden rounded-xl border border-border bg-surface lg:col-span-4"
              }
            >
              {selectedId ? (
                // 2026-04-27 · 用 ErrorBoundary 包裹详情面板。一个解析失
                // 败的 csv / 损坏的 drawio / 异常的 office 文件不应该让整
                // 个面板崩溃,降级到"渲染失败 · 可下载原文件"。resetKey
                // 用 selectedId,切换到别的制品时 boundary 自动 reset。
                <ErrorBoundary
                  resetKey={selectedId}
                  fallback={({ error, reset }) => (
                    <DetailErrorFallback
                      artifactId={selectedId}
                      error={error}
                      onReset={reset}
                      t={t}
                    />
                  )}
                >
                  <ArtifactDetail artifactId={selectedId} />
                </ErrorBoundary>
              ) : (
                <DetailPlaceholder t={t} />
              )}
            </main>
          )}
        </div>
      </div>
      {/* Floating bulk action bar · only renders when ≥1 item is in the
          bulk-selection set. Patterns from Linear (issue list bulk) and
          Gmail (selection toolbar). Pin/Unpin label adapts: if all picked
          items are currently pinned, the action becomes "Unpin". */}
      {bulkSelected.size > 0 ? (
        <BulkActionBar
          count={bulkSelected.size}
          allPinned={allPinned}
          busy={bulkBusy}
          onPinToggle={bulkPin}
          onDelete={bulkDeleteRequest}
          onClear={clearBulk}
        />
      ) : null}
      <ConfirmDialog
        open={bulkDeleteConfirm}
        title={`Delete ${bulkSelected.size} artifact${bulkSelected.size === 1 ? "" : "s"}?`}
        message="Soft delete · still recoverable from the database. The metadata row stays for 30 days."
        confirmLabel="Delete"
        danger
        busy={bulkBusy}
        onConfirm={bulkDeleteConfirmed}
        onCancel={() => setBulkDeleteConfirm(false)}
      />
    </AppShell>
  );
}

function BulkActionBar({
  count,
  allPinned,
  busy,
  onPinToggle,
  onDelete,
  onClear,
}: {
  count: number;
  allPinned: boolean;
  busy: boolean;
  onPinToggle: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const t = useTranslations("artifacts.page");
  const tBulk = useTranslations("artifacts.page.bulk");
  return (
    <div
      role="toolbar"
      aria-label={t("bulkActionsAria")}
      className="fixed bottom-6 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2 shadow-soft-lg animate-fade-up"
    >
      <span className="font-mono text-[11px] text-text-muted">
        {tBulk("selected", { n: count })}
      </span>
      <span className="h-4 w-px bg-border" aria-hidden />
      <button
        type="button"
        onClick={onPinToggle}
        disabled={busy}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] text-text-muted transition-colors duration-fast hover:border-border-strong hover:text-text disabled:opacity-50"
      >
        <Icon name="check" size={12} />
        {allPinned ? tBulk("unpin") : tBulk("pin")}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2.5 text-[12px] text-danger transition-colors duration-fast hover:border-danger/50 disabled:opacity-50"
      >
        <Icon name="trash-2" size={12} />
        {tBulk("delete")}
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label={t("clearSelectionAria")}
        title={t("clearSelectionAria")}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-subtle transition-colors duration-fast hover:bg-surface-2 hover:text-text"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

// ─── Hero / Stats ─────────────────────────────────────────────────────────

function Hero({
  stats,
  title,
  subtitle,
  t,
  activeKind,
  onPickKind,
}: {
  stats: ArtifactStatsDto | null;
  title: string;
  subtitle: string;
  t: ReturnType<typeof useTranslations>;
  activeKind: ArtifactKind | "";
  onPickKind: (k: ArtifactKind) => void;
}) {
  return (
    <header className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex h-5 items-center gap-1 rounded-full bg-primary-muted px-2 text-caption font-mono font-semibold uppercase tracking-wider text-primary">
            <Icon name="folder" size={10} />
            artifacts
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
          <p className="text-sm text-text-muted">{subtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          icon="layout-grid"
          tone="primary"
          label={t("stats.total")}
          value={stats ? String(stats.total) : "—"}
          hint={t("stats.totalHint")}
        />
        <Kpi
          icon="database"
          tone="default"
          label={t("stats.size")}
          value={stats ? formatBytes(stats.total_bytes) : "—"}
          hint={t("stats.sizeHint")}
        />
        <Kpi
          icon="check"
          tone="warning"
          label={t("stats.pinned")}
          value={stats ? String(stats.pinned) : "—"}
          hint={t("stats.pinnedHint")}
        />
        <Kpi
          icon="clock"
          tone="success"
          label={t("stats.last7d")}
          value={stats ? String(stats.last_7d) : "—"}
          hint={t("stats.last7dHint")}
        />
      </div>

      {stats && stats.total > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <ByKindStrip
            stats={stats}
            t={t}
            activeKind={activeKind}
            onPickKind={onPickKind}
          />
          <ActivityCard stats={stats} t={t} />
        </div>
      ) : null}
    </header>
  );
}

function ActivityCard({
  stats,
  t,
}: {
  stats: ArtifactStatsDto;
  t: ReturnType<typeof useTranslations>;
}) {
  const employeeName = useEmployeeNames();
  const max = Math.max(1, ...stats.daily_counts);
  // Plain SVG sparkline · same primitive used in cockpit but inlined here
  // since we want a slightly different visual treatment (filled-area under
  // the line, end-of-line dot to anchor today). 14 buckets · 200×40 vbox.
  const w = 200;
  const h = 40;
  const stepX = stats.daily_counts.length > 1 ? w / (stats.daily_counts.length - 1) : 0;
  const points = stats.daily_counts.map((v, i) => {
    const x = i * stepX;
    const y = h - (v / max) * (h - 6) - 3;
    return { x, y };
  });
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${w},${h} L0,${h} Z`;
  const last = points[points.length - 1];

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <div className="text-caption font-mono uppercase tracking-wider text-text-muted">
            {t("stats.activity")}
          </div>
          <div className="text-caption text-text-subtle">{t("stats.activityHint")}</div>
        </div>
        <div className="font-mono text-2xl font-semibold tabular-nums text-text">
          {stats.last_7d}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full">
        <path d={areaPath} fill="var(--color-primary)" fillOpacity={0.12} />
        <path
          d={linePath}
          stroke="var(--color-primary)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {last ? (
          <circle cx={last.x} cy={last.y} r={2.4} fill="var(--color-primary)" />
        ) : null}
      </svg>

      {stats.top_employees.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-caption font-mono uppercase tracking-wider text-text-muted">
              {t("stats.contributors")}
            </span>
            <span className="text-caption text-text-subtle">{t("stats.contributorsHint")}</span>
          </div>
          <ul className="space-y-1.5">
            {stats.top_employees.map((row) => {
              const pct =
                stats.top_employees[0]?.count
                  ? (row.count / stats.top_employees[0].count) * 100
                  : 0;
              const displayName = employeeName(row.key);
              return (
                <li key={row.key} className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-surface-2 text-text-muted">
                    <Icon name="users" size={11} />
                  </span>
                  <span
                    className="text-caption text-text truncate max-w-[140px]"
                    title={row.key}
                  >
                    {displayName}
                  </span>
                  <div className="relative ml-2 h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-primary"
                      style={{ width: `${pct}%`, opacity: 0.85 }}
                    />
                  </div>
                  <span className="font-mono text-caption tabular-nums text-text-muted">
                    {row.count}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: IconName;
  tone: "primary" | "success" | "warning" | "default";
  label: string;
  value: string;
  hint: string;
}) {
  const tile =
    tone === "primary"
      ? "bg-primary-muted text-primary"
      : tone === "success"
      ? "bg-success-soft text-success"
      : tone === "warning"
      ? "bg-warning-soft text-warning"
      : "bg-surface-2 text-text-muted";
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm">
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${tile}`}>
          <Icon name={icon} size={14} />
        </span>
        <span className="text-caption font-mono uppercase tracking-wider text-text-muted">
          {label}
        </span>
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-text">
        {value}
      </div>
      <div className="text-caption text-text-subtle">{hint}</div>
    </div>
  );
}

function ByKindStrip({
  stats,
  t,
  activeKind,
  onPickKind,
}: {
  stats: ArtifactStatsDto;
  t: ReturnType<typeof useTranslations>;
  activeKind: ArtifactKind | "";
  onPickKind: (k: ArtifactKind) => void;
}) {
  // Sort kinds by count desc · stable bar widths against the largest
  // bucket give visual rhythm. Each row is now clickable — it filters
  // the list by that kind (click again to clear). Active row gets a
  // primary border + tinted bar so the bound between the breakdown and
  // the filter selector is obvious.
  const entries = Object.entries(stats.by_kind).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] ?? 1;
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-caption font-mono uppercase tracking-wider text-text-muted">
          {t("stats.byKind")}
        </span>
        {stats.largest_kind ? (
          <span className="text-caption text-text-subtle">
            {t("stats.topKindHint", { kind: stats.largest_kind })}
          </span>
        ) : null}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-3 lg:grid-cols-4">
        {entries.map(([k, n]) => {
          const pct = (n / max) * 100;
          const isActive = activeKind === k;
          return (
            <li key={k}>
              <button
                type="button"
                onClick={() => onPickKind(k as ArtifactKind)}
                aria-pressed={isActive}
                className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 transition-colors duration-fast ${
                  isActive
                    ? "border-primary/40 bg-primary-muted/40"
                    : "border-transparent hover:border-border hover:bg-surface-2/60"
                }`}
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${
                    isActive ? "bg-primary text-primary-fg" : "bg-surface-2 text-text-muted"
                  }`}
                >
                  <Icon name={KIND_ICON[k as ArtifactKind] ?? "file"} size={12} />
                </span>
                <span
                  className={`font-mono text-caption ${isActive ? "text-primary" : "text-text"}`}
                >
                  {k}
                </span>
                <div className="relative ml-2 h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-primary"
                    style={{ width: `${pct}%`, opacity: isActive ? 1 : 0.85 }}
                  />
                </div>
                <span className="font-mono text-caption tabular-nums text-text-muted">{n}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DateRangePill({
  value,
  onChange,
  t,
}: {
  value: DateRange;
  onChange: (v: DateRange) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const opts: Array<{ key: DateRange; label: string }> = [
    { key: "all", label: t("filters.dateAll") },
    { key: "7d", label: t("filters.date7d") },
    { key: "30d", label: t("filters.date30d") },
  ];
  return (
    <div className="inline-flex h-9 items-center rounded-xl border border-border bg-surface p-0.5">
      {opts.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            className={`inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] transition-colors duration-fast ${
              active
                ? "bg-primary-muted text-primary"
                : "text-text-muted hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ActiveFilterChips({
  t,
  q,
  kind,
  pinnedOnly,
  dateRange,
  onClearQ,
  onClearKind,
  onClearPinned,
  onClearDate,
  onClearAll,
}: {
  t: ReturnType<typeof useTranslations>;
  q: string;
  kind: ArtifactKind | "";
  pinnedOnly: boolean;
  dateRange: DateRange;
  onClearQ: () => void;
  onClearKind: () => void;
  onClearPinned: () => void;
  onClearDate: () => void;
  onClearAll: () => void;
}) {
  const chips: Array<{ label: string; onClear: () => void }> = [];
  if (q) chips.push({ label: `“${q}”`, onClear: onClearQ });
  if (kind) chips.push({ label: kind, onClear: onClearKind });
  if (pinnedOnly) chips.push({ label: t("filters.pinnedOnly"), onClear: onClearPinned });
  if (dateRange === "7d") chips.push({ label: t("filters.date7d"), onClear: onClearDate });
  if (dateRange === "30d") chips.push({ label: t("filters.date30d"), onClear: onClearDate });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c, i) => (
        <span
          key={i}
          className="inline-flex h-6 items-center gap-1 rounded-full border border-primary/30 bg-primary-muted px-2 text-caption font-mono text-primary"
        >
          {c.label}
          <button
            type="button"
            onClick={c.onClear}
            aria-label={t("filters.removeChipAria", { label: c.label })}
            className="inline-flex h-4 w-4 items-center justify-center rounded text-primary/70 hover:text-primary"
          >
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-caption text-text-subtle transition-colors duration-fast hover:text-text-muted"
      >
        <Icon name="x" size={10} />
        {t("filters.clearAll")}
      </button>
    </div>
  );
}

// ─── Empty / Placeholder ──────────────────────────────────────────────────

function EmptyList({
  q,
  kind,
  hasActiveFilters,
  onClearAll,
  t,
}: {
  q: string;
  kind: string;
  hasActiveFilters: boolean;
  onClearAll: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  // 2026-04-27 · 空态文案与 filter context 联动。原来不论筛 csv 还是
  // 筛 mermaid 都显示 "暂无制品",用户得自己回想"我筛了什么"。现在
  // 按主导维度精确反馈:有 kind → "没有 csv 类型"· 有 q → "没找到
  // \"foo\""· 仅 pinned → "没有置顶的"· 全空 → "工作区还没产出"。
  const trimmedQ = q.trim();
  const isFiltered = trimmedQ.length > 0 || kind !== "" || hasActiveFilters;
  let headline: string;
  let detail: string | null = null;
  if (!isFiltered) {
    headline = t("emptyAll");
    detail = t("emptyAllHint");
  } else if (kind && trimmedQ) {
    headline = t("emptyKindAndQ", { kind, query: trimmedQ });
    detail = t("emptyClearHint");
  } else if (kind) {
    headline = t("emptyKind", { kind });
    detail = t("emptyClearHint");
  } else if (trimmedQ) {
    headline = t("emptyQuery", { query: trimmedQ });
    detail = t("emptyClearHint");
  } else {
    // pinnedOnly / dateRange 触发的空态
    headline = t("empty");
    detail = t("emptyClearHint");
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-muted text-primary">
        <Icon name="folder" size={20} />
      </span>
      <p className="text-sm font-medium text-text">{headline}</p>
      {detail && (
        <p className="max-w-xs text-caption text-text-muted">{detail}</p>
      )}
      {isFiltered && (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-caption text-text-muted transition-colors duration-fast hover:border-border-strong hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Icon name="x" size={11} />
          {t("filters.clearAll")}
        </button>
      )}
    </div>
  );
}

/**
 * SkeletonList · shape-of-final-content placeholder while the list is
 * loading. Reference: Vercel deployments + GitHub Files. Reduces perceived
 * latency vs a centered spinner because the user can already see "rows
 * are coming" and the surrounding chrome stays put when data lands.
 */
function SkeletonList({ viewMode }: { viewMode: "list" | "grid" }) {
  // 6 skeleton rows for list, 6 cards for grid · enough to fill the
  // typical viewport without thrashing the DOM if content lands fast.
  const count = 6;
  if (viewMode === "grid") {
    return (
      <ul aria-busy className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center gap-2">
              <span className="h-9 w-9 rounded-lg bg-surface-2 animate-pulse-soft" />
              <div className="flex-1 space-y-2">
                <span className="block h-3 w-[70%] rounded bg-surface-2 animate-pulse-soft" />
                <span className="block h-2 w-[35%] rounded bg-surface-2 animate-pulse-soft" />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="h-2 w-8 rounded bg-surface-2 animate-pulse-soft" />
              <span className="h-2 w-12 rounded bg-surface-2 animate-pulse-soft" />
              <span className="h-2 w-8 rounded bg-surface-2 animate-pulse-soft" />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul aria-busy className="flex flex-col gap-1 p-2">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-2 rounded-md px-2 py-2">
          <span className="h-7 w-7 rounded-md bg-surface-2 animate-pulse-soft" />
          <div className="flex-1 space-y-1.5">
            <span className="block h-3 w-[60%] rounded bg-surface-2 animate-pulse-soft" />
            <span className="block h-2 w-[35%] rounded bg-surface-2 animate-pulse-soft" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DetailPlaceholder({
  t,
}: {
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-text-muted">
        <Icon name="eye" size={20} />
      </span>
      <p className="text-sm text-text-muted">{t("selectHint")}</p>
    </div>
  );
}

/**
 * Detail panel fallback · 渲染崩溃时的友好降级 (R8)。
 * 提供:错误信息(<details> 里折叠原始 stack,默认收起)+ "重试" +
 * "下载原文件" 两个出口。下载用 /api/artifacts/{id}/content?download
 * 原始字节流,即便前端 view 渲染挂了也能拿原始数据。
 */
function DetailErrorFallback({
  artifactId,
  error,
  onReset,
  t,
}: {
  artifactId: string;
  error: Error;
  onReset: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <Icon name="alert-triangle" size={22} />
      </span>
      <p className="text-sm font-medium text-text">{t("detailErrorTitle")}</p>
      <p className="max-w-md text-caption text-text-muted leading-relaxed">
        {t("detailErrorHint")}
      </p>
      <details className="max-w-md text-left">
        <summary className="cursor-pointer text-[11px] font-mono text-text-subtle hover:text-text-muted">
          <Icon
            name="chevron-down"
            size={10}
            className="inline-block -mt-0.5 mr-0.5 transition-transform"
          />
          {t("detailErrorShow")}
        </summary>
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-surface-2 px-3 py-2 text-[10.5px] leading-relaxed text-text-muted whitespace-pre-wrap break-all">
          {error.message}
        </pre>
      </details>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-caption text-text-muted transition-colors duration-fast hover:border-border-strong hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Icon name="refresh" size={11} />
          {t("detailErrorRetry")}
        </button>
        <a
          href={`/api/artifacts/${artifactId}/content?download=1`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-caption text-primary-fg shadow-soft-sm hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
        >
          <Icon name="download" size={11} />
          {t("detailErrorDownload")}
        </a>
      </div>
    </div>
  );
}
