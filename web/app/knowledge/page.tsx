"use client";

/**
 * /knowledge — L1 KB hub (post 2026-04-27 redesign).
 *
 * Replaces the old single-page that crammed KB picker + sidebar + main + drawer
 * + 4 modals onto one URL. Now this page only answers ONE question:
 * "Which KB do I want to work in?". Each KB is a clickable card with health
 * KPIs and a sparkline; clicking drills into /knowledge/[kbId].
 *
 * 0-KB state shows the OnboardingWizard inline. The "+ New KB" action keeps
 * its modal form because creating a KB is action-triggered (not its own
 * destination).
 *
 * Drill-down design: see docs/specs/kb/2026-04-27-redesign-proposal.md.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/icon";
import { ErrorState, LoadingState } from "@/components/state";
import { KBCard } from "@/components/knowledge/KBCard";
import { CreateKBModal } from "@/components/knowledge/CreateKBModal";
import { OnboardingWizard } from "@/components/knowledge/OnboardingWizard";
import {
  type EmbeddingModelOption,
  type KBDto,
  type KBHealthDto,
  getKBHealth,
  listEmbeddingModels,
  listKBs,
} from "@/lib/kb-api";

export default function KnowledgeHubPage() {
  const t = useTranslations("knowledge");
  const router = useRouter();
  const [kbs, setKbs] = useState<KBDto[] | null>(null);
  const [models, setModels] = useState<EmbeddingModelOption[]>([]);
  const [healthByKb, setHealthByKb] = useState<Record<string, KBHealthDto | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [pageState, setPageState] = useState<"loading" | "ok" | "error">(
    "loading",
  );

  async function refresh() {
    try {
      const data = await listKBs();
      setKbs(data);
      setPageState("ok");
      // Fan out a health request per KB. Failures are silent so one bad
      // KB can't blank the whole grid.
      for (const k of data) {
        getKBHealth(k.id, 30)
          .then((h) => setHealthByKb((prev) => ({ ...prev, [k.id]: h })))
          .catch(() => undefined);
      }
    } catch (e) {
      setError(String(e));
      setPageState("error");
    }
  }

  useEffect(() => {
    void refresh();
    listEmbeddingModels()
      .then(setModels)
      .catch((e) => setError(String(e)));
  }, []);

  // Sort: most-recently-active first; ties broken by name.
  const sortedKbs = useMemo(() => {
    if (!kbs) return [];
    return [...kbs].sort((a, b) => {
      const ta = b.updated_at.localeCompare(a.updated_at);
      return ta !== 0 ? ta : a.name.localeCompare(b.name);
    });
  }, [kbs]);

  return (
    <AppShell>
      <div className="flex h-full flex-col gap-4 p-6">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          count={kbs?.length ?? 0}
        />

        {error && (
          <div className="flex items-center justify-between rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            <span className="truncate">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-3 text-text-subtle hover:text-text"
              aria-label={t("dismissAria")}
            >
              ✕
            </button>
          </div>
        )}

        {/* Toolbar — minimal: just a "+ New" button. The KB picker and
            search/ask widgets all live inside L2 now. */}
        {pageState === "ok" && kbs && kbs.length > 0 && (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-[12px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover"
            >
              <Icon name="plus" size={13} />
              {t("toolbar.newKb")}
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {pageState === "loading" && (
            <LoadingState
              title={t("sidebar.loadingTitle")}
              description={t("sidebar.loadingDesc")}
            />
          )}
          {pageState === "error" && (
            <ErrorState title={error || t("loadFailed")} />
          )}

          {pageState === "ok" && kbs && kbs.length === 0 && (
            <OnboardingWizard
              models={models}
              onCreate={() => setShowCreate(true)}
            />
          )}

          {pageState === "ok" && sortedKbs.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sortedKbs.map((kb) => (
                <Link
                  key={kb.id}
                  href={`/knowledge/${kb.id}`}
                  className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <KBCard kb={kb} health={healthByKb[kb.id] ?? null} />
                </Link>
              ))}
            </div>
          )}
        </div>

        {showCreate && (
          <CreateKBModal
            models={models}
            onClose={() => setShowCreate(false)}
            onCreated={async (kb) => {
              setShowCreate(false);
              await refresh();
              router.push(`/knowledge/${kb.id}`);
            }}
            onError={setError}
          />
        )}
      </div>
    </AppShell>
  );
}
