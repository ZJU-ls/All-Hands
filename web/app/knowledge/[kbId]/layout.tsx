"use client";

/**
 * Shared chrome for /knowledge/[kbId]/*. Provides:
 *  - back link to L1 hub
 *  - KB name + stats summary (loaded once at this layout level)
 *  - tab bar (Overview / Documents / Ask / Search / Settings)
 *  - stale-embedding banner (if any)
 *
 * Children render the active tab's content. The KB row is fetched here and
 * shared down via React context so each tab doesn't refetch.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/ui/icon";
import { ErrorState, LoadingState } from "@/components/state";
import {
  type KBDto,
  type KBHealthDto,
  getKB,
  getKBHealth,
  reembedAll,
} from "@/lib/kb-api";
import { KBContext } from "@/components/knowledge/KBContext";

const TABS: {
  id: string;
  match: (path: string, base: string) => boolean;
  href: (kbId: string) => string;
  labelKey: "overview" | "docs" | "ask" | "search" | "settings";
  icon:
    | "info"
    | "file-text"
    | "sparkles"
    | "search"
    | "settings";
}[] = [
  {
    id: "overview",
    match: (p, b) => p === b,
    href: (id) => `/knowledge/${id}`,
    labelKey: "overview",
    icon: "info",
  },
  {
    id: "docs",
    match: (p, b) => p === `${b}/docs` || p.startsWith(`${b}/docs/`),
    href: (id) => `/knowledge/${id}/docs`,
    labelKey: "docs",
    icon: "file-text",
  },
  {
    id: "ask",
    match: (p, b) => p.startsWith(`${b}/ask`),
    href: (id) => `/knowledge/${id}/ask`,
    labelKey: "ask",
    icon: "sparkles",
  },
  {
    id: "search",
    match: (p, b) => p.startsWith(`${b}/search`),
    href: (id) => `/knowledge/${id}/search`,
    labelKey: "search",
    icon: "search",
  },
  {
    id: "settings",
    match: (p, b) => p.startsWith(`${b}/settings`),
    href: (id) => `/knowledge/${id}/settings`,
    labelKey: "settings",
    icon: "settings",
  },
];

export default function KBLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ kbId: string }>();
  const kbId = params?.kbId;
  const pathname = usePathname() ?? "";
  const t = useTranslations("knowledge.l2");
  const tStale = useTranslations("knowledge.stale");
  const [kb, setKb] = useState<KBDto | null>(null);
  const [health, setHealth] = useState<KBHealthDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reembedBusy, setReembedBusy] = useState(false);

  async function refreshKb() {
    if (!kbId) return;
    try {
      const [kbRow, healthRow] = await Promise.all([
        getKB(kbId),
        getKBHealth(kbId, 30).catch(() => null),
      ]);
      setKb(kbRow);
      setHealth(healthRow);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void refreshKb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId]);

  async function runReembedAll() {
    if (!kbId || reembedBusy) return;
    setReembedBusy(true);
    try {
      const res = await reembedAll(kbId);
      alert(
        tStale("doneSummary", {
          processed: res.processed,
          succeeded: res.succeeded,
          failed: res.failed,
        }),
      );
      await refreshKb();
    } catch (e) {
      setError(String(e));
    } finally {
      setReembedBusy(false);
    }
  }

  const base = kbId ? `/knowledge/${kbId}` : "";
  const activeTab = useMemo(
    () => TABS.find((tab) => tab.match(pathname, base))?.id ?? "overview",
    [pathname, base],
  );

  if (error) {
    return (
      <AppShell>
        <div className="p-6">
          <ErrorState title={error} />
        </div>
      </AppShell>
    );
  }

  if (!kb) {
    return (
      <AppShell>
        <div className="p-6">
          <LoadingState title={t("loadingTitle")} description={t("loadingDesc")} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <KBContext.Provider
        value={{ kb, health, refresh: refreshKb, setHealth }}
      >
        <div className="flex h-full min-h-0 flex-col">
          {/* Chrome — KB header */}
          <div className="border-b border-border bg-surface px-6 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/knowledge"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-2 px-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text"
              >
                <Icon name="chevron-left" size={11} />
                {t("backToHub")}
              </Link>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Icon name="book-open" size={14} className="text-primary" />
                <h1 className="truncate text-[15px] font-semibold text-text">
                  {kb.name}
                </h1>
                <span className="font-mono text-[10px] text-text-subtle">
                  · {kb.document_count} docs · {kb.chunk_count} chunks
                </span>
              </div>
            </div>
            {/* Tab bar */}
            <nav className="mt-3 -mb-3 flex gap-1 overflow-x-auto">
              {TABS.map((tab) => {
                const active = tab.id === activeTab;
                return (
                  <Link
                    key={tab.id}
                    href={tab.href(kb.id)}
                    className={`-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13px] transition duration-fast ${
                      active
                        ? "border-primary text-text"
                        : "border-transparent text-text-muted hover:text-text"
                    }`}
                  >
                    <Icon name={tab.icon} size={13} />
                    {t(`tabs.${tab.labelKey}`)}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Stale embedding banner */}
          {(health?.chunks_missing_embeddings ?? 0) > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/40 bg-warning-soft px-5 py-2 text-[12px]">
              <div className="flex items-center gap-2">
                <Icon name="alert-triangle" size={13} className="text-warning" />
                <span className="text-text">
                  {tStale("body", {
                    missing: health?.chunks_missing_embeddings ?? 0,
                    total: health?.chunk_count ?? 0,
                  })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void runReembedAll()}
                disabled={reembedBusy}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-warning/40 bg-surface px-2.5 text-[11px] font-medium text-text hover:border-warning hover:text-warning disabled:opacity-40"
              >
                <Icon name="refresh" size={11} />
                {reembedBusy ? tStale("running") : tStale("cta")}
              </button>
            </div>
          )}

          {/* Active tab content */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </div>
      </KBContext.Provider>
    </AppShell>
  );
}
