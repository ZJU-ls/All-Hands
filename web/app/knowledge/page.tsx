"use client";

/**
 * /knowledge — Knowledge Base workspace page.
 *
 * Visual contract: Brand Blue Dual Theme (ADR 0016). Tokens used:
 *   surfaces  → bg-surface · bg-surface-2 · bg-surface-3
 *   borders   → border-border · border-border-strong
 *   text      → text-text · text-text-muted · text-text-subtle
 *   accent    → bg-primary · bg-primary-muted · text-primary · text-primary-fg
 *   semantics → text-success/warning/danger + bg-success-soft/...
 *   shape     → rounded-xl  ·  inputs h-9
 *   types     → text-[13px] body · font-mono text-[10px] uppercase tracking-[0.15em]
 *               for section labels (matches /artifacts pattern).
 *
 * Layout: 3-pane grid that collapses on small screens. KB list (3 cols) ·
 * docs + tools (6) · search results / tips (3). Entire page sits inside
 * AppShell so the global sidebar / topbar render around it.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/icon";
import {
  type DocumentDto,
  type EmbeddingModelOption,
  type KBDto,
  type ScoredChunkDto,
  createKB,
  listDocuments,
  listEmbeddingModels,
  listKBs,
  searchKB,
  updateRetrievalConfig,
  uploadDocument,
} from "@/lib/kb-api";

const SECTION_LABEL =
  "font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle";
const INPUT =
  "h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none";
const SMALL_INPUT =
  "h-8 w-full rounded-lg border border-border bg-surface-2 px-2.5 text-[12px] text-text focus:border-border-strong focus:outline-none";
const SECONDARY_BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast";
const PRIMARY_BTN =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-[13px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-40 transition duration-fast";

function StatePill({ state }: { state: string }) {
  const style =
    state === "ready"
      ? "border-success/30 bg-success-soft text-success"
      : state === "failed"
        ? "border-danger/30 bg-danger-soft text-danger"
        : "border-warning/30 bg-warning-soft text-warning";
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-2 font-mono text-[10px] uppercase tracking-wide ${style}`}
    >
      {state}
    </span>
  );
}

function MimeChip({ mime }: { mime: string }) {
  const ext = mime.split("/").pop() || mime;
  return (
    <span className="inline-flex h-5 items-center rounded-md border border-border bg-surface-2 px-1.5 font-mono text-[10px] text-text-muted">
      {ext}
    </span>
  );
}

export default function KnowledgePage() {
  const t = useTranslations("knowledge");
  const [kbs, setKbs] = useState<KBDto[] | null>(null);
  const [activeKb, setActiveKb] = useState<KBDto | null>(null);
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [models, setModels] = useState<EmbeddingModelOption[]>([]);
  const [chosenModel, setChosenModel] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ScoredChunkDto[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCfg, setShowCfg] = useState(false);

  async function refreshKbs(preserveActive?: KBDto | null) {
    try {
      const data = await listKBs();
      setKbs(data);
      const target = preserveActive
        ? data.find((k) => k.id === preserveActive.id)
        : null;
      if (target) setActiveKb(target);
      else if (!activeKb && data[0]) setActiveKb(data[0]);
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshDocs(kbId: string) {
    try {
      setDocs(await listDocuments(kbId, { limit: 100 }));
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void refreshKbs();
    listEmbeddingModels()
      .then((m) => {
        setModels(m);
        const def =
          m.find((x) => x.is_default && x.available) ?? m.find((x) => x.available);
        if (def) setChosenModel(def.ref);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeKb) void refreshDocs(activeKb.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKb?.id]);

  async function handleCreateKB() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const kb = await createKB({
        name: newName.trim(),
        embedding_model_ref: chosenModel || undefined,
      });
      setNewName("");
      await refreshKbs(kb);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleUpload(file: File) {
    if (!activeKb) return;
    setUploading(true);
    try {
      await uploadDocument(activeKb.id, file, { title: file.name });
      await refreshDocs(activeKb.id);
      await refreshKbs(activeKb);
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  async function handleSearch() {
    if (!activeKb || !searchQuery.trim()) return;
    setSearching(true);
    setResults(null);
    try {
      setResults(await searchKB(activeKb.id, searchQuery.trim()));
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  }

  return (
    <AppShell>
      <div className="flex h-full flex-col gap-4 p-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />

        {error && (
          <div className="flex items-center justify-between rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-text-subtle hover:text-text ml-3"
            >
              ×
            </button>
          </div>
        )}

        <div className="grid flex-1 grid-cols-12 gap-4 overflow-hidden">
          {/* ── Left · KB list + create form */}
          <aside className="col-span-12 flex flex-col overflow-hidden rounded-xl border border-border bg-surface lg:col-span-3">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className={SECTION_LABEL}>Knowledge Bases</div>
              <span className="font-mono text-[10px] text-text-subtle">
                {kbs?.length ?? "—"}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {kbs === null && (
                <div className="px-3 py-2 text-[12px] text-text-subtle">loading…</div>
              )}
              {kbs?.length === 0 && (
                <div className="px-3 py-6 text-center text-[12px] text-text-muted">
                  {t("kbsEmptyTitle")}
                  <br />
                  <span className="text-text-subtle">{t("kbsEmptyHint")}</span>
                </div>
              )}
              <ul className="space-y-1">
                {kbs?.map((k) => {
                  const active = activeKb?.id === k.id;
                  return (
                    <li key={k.id}>
                      <button
                        type="button"
                        onClick={() => setActiveKb(k)}
                        className={
                          active
                            ? "flex w-full flex-col items-start gap-0.5 rounded-lg bg-primary-muted px-3 py-2 text-left transition"
                            : "flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left text-text-muted hover:bg-surface-2 hover:text-text transition"
                        }
                      >
                        <span
                          className={`text-[13px] font-medium ${active ? "text-text" : ""}`}
                        >
                          {k.name}
                        </span>
                        <span className="font-mono text-[10px] text-text-subtle">
                          {t("kbStats", {
                            docs: k.document_count,
                            chunks: k.chunk_count,
                            dim: k.embedding_dim,
                          })}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex flex-col gap-2 border-t border-border p-3">
              <div className={SECTION_LABEL}>{t("createKbSectionLabel")}</div>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("newKbPlaceholderShort")}
                className={SMALL_INPUT}
              />
              <select
                value={chosenModel}
                onChange={(e) => setChosenModel(e.target.value)}
                className={SMALL_INPUT}
                title={t("embeddingModel")}
              >
                {models.length === 0 && <option>{t("loadingModels")}</option>}
                {models.map((m) => (
                  <option key={m.ref} value={m.ref} disabled={!m.available}>
                    {m.label} · {m.dim}d
                    {m.is_default ? ` · ${t("modelDefault")}` : ""}
                    {!m.available ? ` · (${m.reason})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleCreateKB}
                disabled={creating || !newName.trim()}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-40 transition duration-fast"
              >
                <Icon name="plus" size={12} />
                {creating ? t("creating") : t("createKbShort")}
              </button>
            </div>
          </aside>

          {/* ── Middle · documents + upload + search + tune */}
          <main className="col-span-12 flex flex-col overflow-hidden rounded-xl border border-border bg-surface lg:col-span-6">
            {!activeKb ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-text-muted">
                {t("pickKb")}
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-text">
                      {activeKb.name}
                    </div>
                    <div className="font-mono text-[10px] text-text-subtle">
                      {activeKb.embedding_model_ref} · {activeKb.embedding_dim}d
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCfg((s) => !s)}
                    className={SECONDARY_BTN}
                  >
                    <Icon name="settings" size={13} />
                    {showCfg ? t("collapse") : t("tune")}
                  </button>
                  <label className={`${SECONDARY_BTN} cursor-pointer`}>
                    <Icon name="upload" size={13} />
                    {uploading ? t("uploading") : t("upload")}
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUpload(f);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>

                {/* Tune drawer */}
                {showCfg && (
                  <RetrievalConfigEditor
                    kb={activeKb}
                    onSaved={async (next) => {
                      setActiveKb(next);
                      setShowCfg(false);
                      await refreshKbs(next);
                    }}
                    onError={setError}
                  />
                )}

                {/* Search bar */}
                <div className="flex gap-2 border-b border-border px-4 py-3">
                  <div className="relative flex-1">
                    <Icon
                      name="search"
                      size={13}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      placeholder={t("searchPlaceholder")}
                      className={`${INPUT} pl-9`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSearch}
                    disabled={searching || !searchQuery.trim()}
                    className={PRIMARY_BTN}
                  >
                    {searching ? "…" : t("searchAction")}
                  </button>
                </div>

                {/* Documents list */}
                <div className="flex items-center justify-between px-4 pb-2 pt-3">
                  <div className={SECTION_LABEL}>Documents</div>
                  <span className="font-mono text-[10px] text-text-subtle">
                    {docs?.length ?? "…"}
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                  {docs?.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-[12px] text-text-muted">
                      {t("docsEmptyHint")}
                    </div>
                  )}
                  <ul className="space-y-2">
                    {docs?.map((d) => (
                      <li
                        key={d.id}
                        className="rounded-xl border border-border bg-surface-2 p-3 transition hover:border-border-strong"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <MimeChip mime={d.mime_type} />
                              <span className="truncate text-[13px] font-medium text-text">
                                {d.title}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-text-subtle">
                              <span>🧩 {t("chunks", { n: d.chunk_count })}</span>
                              <span>v{d.version}</span>
                              <span>{(d.size_bytes / 1024).toFixed(1)} KB</span>
                              {d.failed_chunk_count > 0 && (
                                <span className="text-warning">
                                  {t("chunksFailed", { n: d.failed_chunk_count })}
                                </span>
                              )}
                            </div>
                            {d.state_error && (
                              <div className="mt-1.5 rounded-md border border-danger/30 bg-danger-soft px-2 py-1 text-[11px] text-danger">
                                {d.state_error}
                              </div>
                            )}
                          </div>
                          <StatePill state={d.state} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </main>

          {/* ── Right · search results / tips */}
          <aside className="col-span-12 flex flex-col overflow-hidden rounded-xl border border-border bg-surface lg:col-span-3">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className={SECTION_LABEL}>
                {results === null ? t("tipsTitle") : t("resultsTitleShort")}
              </div>
              {results !== null && (
                <span className="font-mono text-[10px] text-text-subtle">
                  {results.length}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {results === null && (
                <div className="space-y-3 text-[12px] leading-relaxed text-text-muted">
                  <p>
                    <span className="font-semibold text-text">{t("tip1Strong")}</span>
                    {t("tip1Body")}
                  </p>
                  <p>
                    {t.rich("tip2Body", {
                      s1: (chunks) => (
                        <span className="rounded bg-surface-2 px-1.5 font-mono text-[11px] text-text">
                          {chunks}
                        </span>
                      ),
                      s2: (chunks) => (
                        <span className="rounded bg-surface-2 px-1.5 font-mono text-[11px] text-text">
                          {chunks}
                        </span>
                      ),
                      s3: (chunks) => (
                        <span className="rounded bg-surface-2 px-1.5 font-mono text-[11px] text-text">
                          {chunks}
                        </span>
                      ),
                    })}
                  </p>
                  <p>
                    {t.rich("tip3Body", {
                      s: (chunks) => (
                        <span className="rounded bg-surface-2 px-1.5 font-mono text-[11px] text-text">
                          {chunks}
                        </span>
                      ),
                      quote: (chunks) => (
                        <span className="block mt-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-text">
                          {chunks}
                        </span>
                      ),
                    })}
                  </p>
                </div>
              )}
              {results !== null && results.length === 0 && (
                <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-[12px] text-text-muted">
                  {t("noResults")}
                </div>
              )}
              <ul className="space-y-2">
                {results?.map((r) => (
                  <li
                    key={r.chunk_id}
                    className="rounded-xl border border-border bg-surface-2 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="inline-flex items-center rounded-md bg-primary-muted px-2 py-0.5 font-mono text-[10px] text-primary">
                        {r.citation}
                      </span>
                      <span className="font-mono text-[10px] text-text-subtle">
                        {r.score.toFixed(4)}
                      </span>
                    </div>
                    {r.section_path && (
                      <div className="mb-1.5 font-mono text-[10px] text-text-subtle">
                        {r.section_path}
                      </div>
                    )}
                    <div className="line-clamp-6 whitespace-pre-wrap text-[12px] leading-relaxed text-text">
                      {r.text}
                    </div>
                    <div className="mt-2 flex gap-3 font-mono text-[10px] text-text-subtle">
                      {r.bm25_rank !== null && r.bm25_rank !== undefined && (
                        <span>BM25 #{r.bm25_rank}</span>
                      )}
                      {r.vector_rank !== null && r.vector_rank !== undefined && (
                        <span>vec #{r.vector_rank}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Inline retrieval-config editor — sits at the top of the docs pane when
 * the user clicks "Tune". Patches via the REST endpoint that mirrors the
 * kb_set_retrieval_config Meta Tool.
 */
function RetrievalConfigEditor({
  kb,
  onSaved,
  onError,
}: {
  kb: KBDto;
  onSaved: (next: KBDto) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("knowledge.cfg");
  const [bm25, setBm25] = useState(kb.retrieval_config.bm25_weight);
  const [vec, setVec] = useState(kb.retrieval_config.vector_weight);
  const [topK, setTopK] = useState(kb.retrieval_config.top_k);
  const [reranker, setReranker] = useState(kb.retrieval_config.reranker);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const next = await updateRetrievalConfig(kb.id, {
        bm25_weight: bm25,
        vector_weight: vec,
        top_k: topK,
        reranker,
      });
      onSaved(next);
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const Field = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
        {label}
      </span>
      {children}
    </label>
  );

  return (
    <div className="border-b border-border bg-surface-2 px-4 py-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={t("bm25Weight")}>
          <input
            type="number"
            min={0}
            step={0.1}
            value={bm25}
            onChange={(e) => setBm25(Number(e.target.value))}
            className="h-8 rounded-lg border border-border bg-surface px-2 text-[12px] text-text focus:border-border-strong focus:outline-none"
          />
        </Field>
        <Field label={t("vectorWeight")}>
          <input
            type="number"
            min={0}
            step={0.1}
            value={vec}
            onChange={(e) => setVec(Number(e.target.value))}
            className="h-8 rounded-lg border border-border bg-surface px-2 text-[12px] text-text focus:border-border-strong focus:outline-none"
          />
        </Field>
        <Field label={t("topK")}>
          <input
            type="number"
            min={1}
            max={100}
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
            className="h-8 rounded-lg border border-border bg-surface px-2 text-[12px] text-text focus:border-border-strong focus:outline-none"
          />
        </Field>
        <Field label={t("rerankerShort")}>
          <select
            value={reranker}
            onChange={(e) =>
              setReranker(e.target.value as "none" | "bge-base" | "cohere")
            }
            className="h-8 rounded-lg border border-border bg-surface px-2 text-[12px] text-text focus:border-border-strong focus:outline-none"
          >
            <option value="none">none</option>
            <option value="bge-base" disabled>
              bge-base · M3
            </option>
            <option value="cohere" disabled>
              cohere · M3
            </option>
          </select>
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex h-8 items-center rounded-lg bg-primary px-4 text-[12px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-40 transition duration-fast"
        >
          {saving ? t("saving") : t("save")}
        </button>
      </div>
    </div>
  );
}
