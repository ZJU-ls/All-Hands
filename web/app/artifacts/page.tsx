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
  pptx: "file",
  video: "play-circle",
  csv: "database",
  xlsx: "database",
  docx: "file",
  pdf: "file",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

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
  }, [kind, sort, q]);

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
        <Hero stats={stats} title={t("title")} subtitle={t("subtitle")} t={t} />

        {/* Filter row · Search + Select dropdowns + count */}
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

          <span className="ml-auto font-mono text-[11px] text-text-subtle">
            {t("count", { n: items.length })}
          </span>
        </div>

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
}: {
  stats: ArtifactStatsDto | null;
  title: string;
  subtitle: string;
  t: ReturnType<typeof useTranslations>;
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
        <ByKindStrip stats={stats} t={t} />
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
}: {
  stats: ArtifactStatsDto;
  t: ReturnType<typeof useTranslations>;
}) {
  // Sort kinds by count desc · stable bar widths against the largest
  // bucket give visual rhythm. The list mirrors the kind filter so the
  // user can mentally pre-pick before clicking.
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
      <ul className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3 lg:grid-cols-4">
        {entries.map(([k, n]) => {
          const pct = (n / max) * 100;
          return (
            <li key={k} className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-surface-2 text-text-muted">
                <Icon name={KIND_ICON[k as ArtifactKind] ?? "file"} size={12} />
              </span>
              <span className="font-mono text-caption text-text">{k}</span>
              <div className="relative ml-2 h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${pct}%`, opacity: 0.85 }}
                />
              </div>
              <span className="font-mono text-caption tabular-nums text-text-muted">{n}</span>
            </li>
          );
        })}
      </ul>
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
