"use client";

/**
 * Global /artifacts page · workspace-wide catalog with stats strip + filter
 * row (token-styled <Select> · no native dropdown chrome) + 2-pane list +
 * detail. Stats refresh on mount and after any artifact_changed SSE frame
 * (create / update / delete / pin), so KPIs reflect what the user sees in
 * the list.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { Icon, type IconName } from "@/components/ui/icon";
import { Select } from "@/components/ui/Select";
import { LoadingState, ErrorState } from "@/components/state";
import { ArtifactList } from "@/components/artifacts/ArtifactList";
import { ArtifactDetail } from "@/components/artifacts/ArtifactDetail";
import {
  artifactStreamUrl,
  getArtifactStats,
  listArtifacts,
  type ArtifactDto,
  type ArtifactKind,
  type ArtifactSort,
  type ArtifactStatsDto,
} from "@/lib/artifacts-api";

const KINDS: ArtifactKind[] = [
  "markdown",
  "code",
  "html",
  "image",
  "data",
  "mermaid",
  "drawio",
];

const SORTS: ArtifactSort[] = [
  "updated_at_desc",
  "created_at_desc",
  "created_at_asc",
  "name_asc",
  "name_desc",
  "size_desc",
];

const KIND_ICON: Record<ArtifactKind, IconName> = {
  markdown: "file",
  code: "code",
  html: "code",
  image: "eye",
  data: "database",
  mermaid: "activity",
  drawio: "layout-grid",
  pdf: "file",
  xlsx: "database",
  csv: "database",
  docx: "file",
  pptx: "file",
  video: "play-circle",
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

  // Refetch list when filters move; throttled-by-React-batch is fine here.
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    void (async () => {
      try {
        const next = await listArtifacts({
          kind: kind || undefined,
          q: q || undefined,
          sort,
          pinned: pinnedOnly || undefined,
          createdAfter,
          limit: 200,
        });
        if (!cancelled) {
          setItems(next);
          setState("ok");
          setError(null);
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
  }, [kind, sort, q, pinnedOnly, createdAfter]);

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
    const onChanged = () => {
      void refreshStats();
    };
    es.addEventListener("artifact_changed", onChanged);
    return () => {
      es.removeEventListener("artifact_changed", onChanged);
      es.close();
    };
  }, [refreshStats]);

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
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
        <Hero
          stats={stats}
          title={t("title")}
          subtitle={t("subtitle")}
          t={t}
          activeKind={kind}
          onPickKind={(k) => setKind(k === kind ? "" : k)}
        />

        {/* Filter row · search + Select + range pills + pinned toggle + count */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search")}
              className="h-9 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="clear search"
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

          <span className="ml-auto font-mono text-[11px] text-text-subtle">
            {t("count", { n: items.length })}
          </span>
        </div>

        {/* Active filter chip strip · removable individual chips + clear-all
            button. Only renders when at least one filter is active. */}
        {hasActiveFilters ? (
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
        ) : null}

        {/* List + detail · stays as 4/8 split on lg */}
        <div className="grid min-h-[60vh] flex-1 grid-cols-12 gap-4">
          <aside className="col-span-12 overflow-y-auto rounded-xl border border-border bg-surface lg:col-span-4 xl:col-span-3">
            {state === "loading" ? (
              <LoadingState title={t("title")} description={t("subtitle")} />
            ) : state === "error" && error ? (
              <ErrorState title={t("loadFailed", { error })} />
            ) : items.length === 0 ? (
              <EmptyList q={q} kind={kind} t={t} />
            ) : (
              <ArtifactList
                artifacts={items}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </aside>

          <main className="col-span-12 overflow-hidden rounded-xl border border-border bg-surface lg:col-span-8 xl:col-span-9">
            {selectedId ? (
              <ArtifactDetail artifactId={selectedId} />
            ) : (
              <DetailPlaceholder t={t} />
            )}
          </main>
        </div>
      </div>
    </AppShell>
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
        <ByKindStrip
          stats={stats}
          t={t}
          activeKind={activeKind}
          onPickKind={onPickKind}
        />
      ) : null}
    </header>
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
  t,
}: {
  q: string;
  kind: string;
  t: ReturnType<typeof useTranslations>;
}) {
  // Differentiate "no artifacts at all" vs "filtered to nothing" so the
  // user knows whether to clear filters or seed work.
  const isFiltered = q.trim().length > 0 || kind !== "";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-muted text-primary">
        <Icon name="folder" size={20} />
      </span>
      <p className="text-sm font-medium text-text">
        {isFiltered ? t("empty") : t("emptyAll")}
      </p>
      {!isFiltered ? (
        <p className="max-w-xs text-caption text-text-muted">{t("emptyAllHint")}</p>
      ) : null}
    </div>
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
