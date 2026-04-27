"use client";

/**
 * /knowledge/[kbId]/settings · Settings tab.
 *
 * Replaces the cramped KBSettingsModal. Full-page with a left sub-nav and
 * right content; each section uses ?section= query so users can deep-link.
 *
 *   ?section=basic      (default)
 *   ?section=retrieval  (BM25/vec weights · top_k · reranker)
 *   ?section=diagnose   (BM25 vs vec vs hybrid recall comparison)
 *   ?section=danger     (delete KB)
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { Select } from "@/components/ui/Select";
import { useKBContext } from "@/components/knowledge/KBContext";
import { Field } from "@/components/knowledge/Field";
import {
  type DiagnoseDto,
  type EmbeddingModelOption,
  type KBStatsDto,
  type RetrievalConfig,
  deleteKB,
  diagnoseSearch,
  getKBStats,
  listEmbeddingModels,
  switchEmbeddingModel,
  updateRetrievalConfig,
} from "@/lib/kb-api";

type Section = "basic" | "retrieval" | "diagnose" | "danger";

const SECTIONS: {
  id: Section;
  icon: "info" | "settings" | "search" | "trash-2";
  labelKey: "basic" | "retrieval" | "diagnose" | "danger";
}[] = [
  { id: "basic", icon: "info", labelKey: "basic" },
  { id: "retrieval", icon: "settings", labelKey: "retrieval" },
  { id: "diagnose", icon: "search", labelKey: "diagnose" },
  { id: "danger", icon: "trash-2", labelKey: "danger" },
];

export default function SettingsTabPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <SettingsTabInner />
    </Suspense>
  );
}

function SettingsTabInner() {
  const { kb, refresh } = useKBContext();
  const t = useTranslations("knowledge.settings");
  const router = useRouter();
  const search = useSearchParams();
  const section = (search.get("section") ?? "basic") as Section;

  function setSection(next: Section) {
    router.replace(`/knowledge/${kb.id}/settings?section=${next}`);
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sub-nav */}
      <aside className="w-52 shrink-0 border-r border-border bg-surface-2 p-3">
        <nav className="space-y-0.5">
          {SECTIONS.map((s) => {
            const active = s.id === section;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition ${
                  active
                    ? "bg-primary-muted text-primary"
                    : "text-text-muted hover:bg-surface hover:text-text"
                }`}
              >
                <Icon name={s.icon} size={13} />
                {t(`tabs.${s.labelKey}`)}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          {section === "basic" && <BasicSection />}
          {section === "retrieval" && <RetrievalSection />}
          {section === "diagnose" && <DiagnoseSection />}
          {section === "danger" && (
            <DangerSection
              onDeleted={async () => {
                await refresh().catch(() => undefined);
                router.push("/knowledge");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Basic — embedding model picker (clickable; per-KB)

function BasicSection() {
  const { kb, refresh } = useKBContext();
  const t = useTranslations("knowledge.basic");
  const [models, setModels] = useState<EmbeddingModelOption[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    listEmbeddingModels().then(setModels).catch(() => undefined);
  }, []);

  const isMock = kb.embedding_model_ref.startsWith("mock:");
  const realAvailable = models.filter(
    (m) => !m.ref.startsWith("mock:") && m.available,
  );

  async function pickModel(ref: string) {
    if (ref === kb.embedding_model_ref || switching) return;
    if (
      !confirm(
        t("switchConfirm", {
          model: ref,
          docs: kb.document_count,
        }),
      )
    )
      return;
    setSwitching(ref);
    try {
      const out = await switchEmbeddingModel(kb.id, ref);
      alert(
        t("switchSummary", {
          processed: out.reembed.processed,
          succeeded: out.reembed.succeeded,
          failed: out.reembed.failed,
        }),
      );
      await refresh();
    } catch (e) {
      alert(`${t("switchFailed")}\n${e}`);
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-[16px] font-semibold text-text">
        {t("sectionTitle")}
      </h2>

      <div
        className={`rounded-xl border p-4 ${
          isMock ? "border-warning/40 bg-warning-soft" : "border-success/30 bg-success-soft"
        }`}
      >
        <div
          className={`flex items-center gap-2 text-[13px] font-semibold ${
            isMock ? "text-warning" : "text-success"
          }`}
        >
          <Icon name={isMock ? "alert-triangle" : "check"} size={14} />
          {isMock ? t("demoStatus") : t("semanticStatus")}
        </div>
        <p
          className={`mt-1.5 text-[12px] leading-relaxed ${
            isMock ? "text-warning/90" : "text-success/90"
          }`}
        >
          {isMock ? t("demoBody") : t("semanticBody")}
        </p>
        <div className="mt-2 font-mono text-[10px] text-text-subtle">
          {t("currentModel", { model: kb.embedding_model_ref })}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
            {t("availableHeading")}
          </span>
          <a
            href="/gateway"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            {t("manageProvider")}
            <Icon name="external-link" size={11} />
          </a>
        </div>

        {realAvailable.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface-2 p-4 text-[12px] text-text-muted">
            <div className="mb-2 flex items-center gap-2 font-medium text-text">
              <Icon name="info" size={13} className="text-primary" />
              {t("noModelsTitle")}
            </div>
            <p className="leading-relaxed">
              {t.rich("noModelsBody", {
                gateway: (chunks) => (
                  <a href="/gateway" className="text-primary underline">
                    {chunks}
                  </a>
                ),
              })}
            </p>
            <a
              href="/gateway"
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg hover:bg-primary-hover"
            >
              <Icon name="plus" size={12} />
              {t("goConfigure")}
            </a>
          </div>
        ) : (
          <>
            <ul className="space-y-1.5">
              {realAvailable.map((m) => {
                const active = m.ref === kb.embedding_model_ref;
                const isSwitching = switching === m.ref;
                return (
                  <li key={m.ref}>
                    <button
                      type="button"
                      onClick={() => void pickModel(m.ref)}
                      disabled={active || switching !== null}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-[12px] transition duration-fast ${
                        active
                          ? "border-success/40 bg-success-soft text-text cursor-default"
                          : isSwitching
                            ? "border-primary bg-primary-muted text-text cursor-wait"
                            : "border-border bg-surface-2 text-text hover:border-primary/40 hover:bg-primary-muted/30"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {active && <Icon name="check" size={12} className="text-success" />}
                        {isSwitching && (
                          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                        )}
                        <span>{m.label}</span>
                      </span>
                      <span className="font-mono text-[10px] text-text-subtle">
                        {isSwitching
                          ? t("switching")
                          : active
                            ? `${t("modelDimHint", { dim: m.dim })} · ${t("currentBadge")}`
                            : t("modelDimHint", { dim: m.dim })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px] text-text-muted">
              <Icon name="info" size={11} className="-mt-px mr-1 inline-block" />
              {t("switchModelHintV2")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Retrieval — BM25 / vector weights, top_k, reranker

function RetrievalSection() {
  const { kb, refresh } = useKBContext();
  const t = useTranslations("knowledge.advanced");
  const tBtn = useTranslations("knowledge.settings");
  const [bm25, setBm25] = useState(kb.retrieval_config.bm25_weight);
  const [vec, setVec] = useState(kb.retrieval_config.vector_weight);
  const [topK, setTopK] = useState(kb.retrieval_config.top_k);
  const [reranker, setReranker] = useState(kb.retrieval_config.reranker);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await updateRetrievalConfig(kb.id, {
        bm25_weight: bm25,
        vector_weight: vec,
        top_k: topK,
        reranker: reranker as RetrievalConfig["reranker"],
      });
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-[16px] font-semibold text-text">{tBtn("tabs.retrieval")}</h2>
      <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-text-muted">
        {t.rich("intro", {
          br: () => <br />,
          mono: (chunks) => <code className="font-mono text-[11px]">{chunks}</code>,
        })}
      </p>

      <Field label={t("fieldBm25")}>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={bm25}
          onChange={(e) => setBm25(Number(e.target.value))}
          className="w-full"
        />
        <div className="font-mono text-[10px] text-text-subtle">{bm25.toFixed(1)}</div>
      </Field>
      <Field label={t("fieldVec")}>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={vec}
          onChange={(e) => setVec(Number(e.target.value))}
          className="w-full"
        />
        <div className="font-mono text-[10px] text-text-subtle">{vec.toFixed(1)}</div>
      </Field>
      <Field label={t("fieldTopK")}>
        <input
          type="number"
          min="1"
          max="50"
          value={topK}
          onChange={(e) => setTopK(Number(e.target.value))}
          className="h-9 w-32 rounded-xl border border-border bg-surface px-3 text-[13px] text-text focus:border-border-strong focus:outline-none"
        />
      </Field>
      <Field label={t("fieldReranker")}>
        <Select
          value={reranker}
          onChange={(v) => setReranker(v as RetrievalConfig["reranker"])}
          options={[
            { value: "none", label: t("rerankerNone") },
            { value: "bge-base", label: t("rerankerBge") },
            { value: "cohere", label: t("rerankerCohere") },
          ]}
          className="w-72"
          triggerClassName="h-9 rounded-xl"
          ariaLabel={t("rerankerAria")}
        />
      </Field>

      {err && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
          {err}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-[12px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40"
        >
          {saving ? tBtn("saving") : tBtn("save")}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Diagnose — BM25 vs vector vs hybrid

function DiagnoseSection() {
  const { kb } = useKBContext();
  const t = useTranslations("knowledge.diagnose");
  const tBtn = useTranslations("knowledge.settings");
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [out, setOut] = useState<DiagnoseDto | null>(null);
  const [stats, setStats] = useState<KBStatsDto | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void getKBStats(kb.id).then(setStats).catch(() => undefined);
  }, [kb.id]);

  async function run() {
    if (!query.trim()) return;
    setRunning(true);
    setErr(null);
    setOut(null);
    try {
      setOut(await diagnoseSearch(kb.id, query.trim(), 5));
      setStats(await getKBStats(kb.id));
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[16px] font-semibold text-text">{tBtn("tabs.diagnose")}</h2>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void run()}
          placeholder={t("queryPlaceholder")}
          className="h-9 flex-1 rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={running || !query.trim()}
          className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-[12px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40"
        >
          {running ? t("running") : t("compare")}
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
          {err}
        </div>
      )}

      {out ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <DiagCol
            title={t("colKeywordTitle")}
            subtitle={t("colKeywordSubtitle")}
            tone="warning"
            items={out.bm25_only}
          />
          <DiagCol
            title={t("colVectorTitle")}
            subtitle={t("colVectorSubtitle")}
            tone="primary"
            items={out.vector_only}
          />
          <DiagCol
            title={t("colHybridTitle")}
            subtitle={t("colHybridSubtitle")}
            tone="success"
            items={out.hybrid}
          />
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-text-muted">
          {t("intro")}
        </p>
      )}

      {stats && stats.count > 0 && (
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
            <span>{t("statsTitle")}</span>
            <span>
              {t("statsSummary", {
                count: stats.count,
                avg: stats.avg_latency_ms?.toFixed(0) ?? "0",
              })}
            </span>
          </div>
          <ul className="space-y-1 text-[11px]">
            {stats.recent.slice(0, 5).map((r, i) => (
              <li
                key={`${r.at}-${i}`}
                className="flex items-center justify-between gap-2 text-text-muted"
              >
                <span className="truncate text-text">{r.query}</span>
                <span className="font-mono text-text-subtle">
                  {t("statsRow", { hits: r.hits, ms: r.latency_ms.toFixed(0) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DiagCol({
  title,
  subtitle,
  tone,
  items,
}: {
  title: string;
  subtitle: string;
  tone: "warning" | "primary" | "success";
  items: { chunk_id: number; score: number; text: string; section_path: string | null }[];
}) {
  const t = useTranslations("knowledge.diagnose");
  const cls =
    tone === "warning"
      ? "border-warning/40 bg-warning-soft"
      : tone === "success"
        ? "border-success/30 bg-success-soft"
        : "border-primary/30 bg-primary-muted";
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface">
      <div className={`rounded-t-xl border-b border-border px-3 py-2 ${cls}`}>
        <div className="text-[12px] font-semibold text-text">{title}</div>
        <div className="font-mono text-[10px] text-text-subtle">{subtitle}</div>
      </div>
      <ul className="space-y-1.5 p-2">
        {items.length === 0 && (
          <li className="px-2 py-3 text-center text-[11px] text-text-subtle">
            {t("noHits")}
          </li>
        )}
        {items.map((r, i) => (
          <li
            key={r.chunk_id}
            className="rounded-lg border border-border bg-surface-2 p-2"
          >
            <div className="mb-1 flex items-center justify-between gap-1 font-mono text-[10px] text-text-subtle">
              <span className="rounded bg-surface px-1.5 py-0.5 text-text">
                #{i + 1}
              </span>
              <span>{r.score.toFixed(4)}</span>
            </div>
            {r.section_path && (
              <div className="mb-1 truncate font-mono text-[10px] text-text-subtle">
                {r.section_path}
              </div>
            )}
            <p className="line-clamp-3 text-[11px] leading-snug text-text">
              {r.text}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Danger — delete KB

function DangerSection({ onDeleted }: { onDeleted: () => void | Promise<void> }) {
  const { kb } = useKBContext();
  const t = useTranslations("knowledge.danger");
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const enabled = confirm === kb.name && !deleting;

  async function doDelete() {
    if (!enabled) return;
    setDeleting(true);
    try {
      await deleteKB(kb.id);
      await onDeleted();
    } catch (e) {
      alert(String(e));
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[16px] font-semibold text-text">{t("heading")}</h2>
      <div className="rounded-xl border border-danger/30 bg-danger-soft p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-danger">
          <Icon name="alert-triangle" size={14} />
          {t("heading")}
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-danger/90">
          {t.rich("warning", {
            prefix: kb.id.slice(0, 8),
            code: (chunks) => <code className="font-mono text-[11px]">{chunks}</code>,
          })}
        </p>
      </div>

      <Field label={t("confirmFieldLabel", { name: kb.name })}>
        <input
          type="text"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={kb.name}
          className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-danger focus:outline-none"
        />
      </Field>

      <button
        type="button"
        onClick={() => void doDelete()}
        disabled={!enabled}
        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-danger px-3 text-[13px] font-medium text-white hover:bg-danger/90 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Icon name="trash-2" size={13} />
        {t("deleteAction")}
      </button>
    </div>
  );
}
