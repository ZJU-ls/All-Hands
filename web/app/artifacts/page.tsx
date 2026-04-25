"use client";

/**
 * Global /artifacts page · workspace-wide catalog of every artifact agents
 * have produced, with multi-dim filtering (kind / employee / conversation /
 * tag / time / search). Reuses ArtifactList for grouping + ArtifactDetail
 * for inspection so the chat-side panel and this page stay visually parallel.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/icon";
import { LoadingState, ErrorState } from "@/components/state";
import { ArtifactList } from "@/components/artifacts/ArtifactList";
import { ArtifactDetail } from "@/components/artifacts/ArtifactDetail";
import {
  listArtifacts,
  type ArtifactDto,
  type ArtifactKind,
  type ArtifactSort,
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

export default function ArtifactsGlobalPage() {
  const t = useTranslations("artifacts.page");
  const [items, setItems] = useState<ArtifactDto[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Filters · controlled state, debounce-free (the filter set is small enough
  // that re-fetching on each change is cheap; a 50ms debounce can land later).
  const [kind, setKind] = useState<ArtifactKind | "">("");
  const [sort, setSort] = useState<ArtifactSort>("updated_at_desc");
  const [q, setQ] = useState("");

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

  const headerCount = useMemo(() => t("count", { n: items.length }), [items.length, t]);

  return (
    <AppShell>
      <div className="flex h-full flex-col gap-4 p-6">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          count={items.length}
        />

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

          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ArtifactKind | "")}
            className="h-9 rounded-xl border border-border bg-surface px-3 text-[13px] text-text focus:border-border-strong focus:outline-none"
          >
            <option value="">{t("allKinds")}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as ArtifactSort)}
            className="h-9 rounded-xl border border-border bg-surface px-3 text-[13px] text-text focus:border-border-strong focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sort.${s}`)}
              </option>
            ))}
          </select>

          <span className="ml-auto font-mono text-[11px] text-text-subtle">{headerCount}</span>
        </div>

        <div className="grid flex-1 grid-cols-12 gap-4 overflow-hidden">
          <aside className="col-span-12 overflow-y-auto rounded-xl border border-border bg-surface lg:col-span-4 xl:col-span-3">
            {state === "loading" ? (
              <LoadingState title={t("title")} description={t("subtitle")} />
            ) : state === "error" && error ? (
              <ErrorState title={t("loadFailed", { error })} />
            ) : items.length === 0 ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-text-muted">
                {t("empty")}
              </div>
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
              <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-text-muted">
                {t("empty")}
              </div>
            )}
          </main>
        </div>
      </div>
    </AppShell>
  );
}
