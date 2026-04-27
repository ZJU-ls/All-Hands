"use client";

/**
 * /knowledge — Knowledge Base workspace page · v2 layout.
 *
 * Reference inspiration:
 *   - Glean: search is the primary surface; results carry citations + scores
 *   - Notion / Confluence: top toolbar with selectors → content canvas
 *   - Anthropic Files: doc grid with click-to-open detail drawer
 *
 * Layout (12-col grid, collapses to single column < lg):
 *
 *   PageHeader (title + subtitle)
 *   ─ Toolbar ────────────────────────────────────────────────
 *     [KB Select ▾]  [🔍 Ask / search …]  [State ▾] [+ Upload]
 *   ─ Body ───────────────────────────────────────────────────
 *     ┌─ 3 cols ─┐  ┌───────── 9 cols ─────────────┐
 *     │ KB info  │  │ Search results (when query)   │
 *     │ Tags     │  │  ── or ──                     │
 *     │ Grants   │  │ Documents grid                │
 *     │ Tune     │  │                               │
 *     └──────────┘  └───────────────────────────────┘
 *
 * Visual contract: Brand Blue Dual Theme tokens only. No native <select>
 * (uses our Select primitive). Empty/error states use the project state
 * components. Right slide-over for doc detail.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { computePopoverSide } from "@/lib/popover-placement";
import { useLocale, useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { AgentMarkdown } from "@/components/chat/AgentMarkdown";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Icon } from "@/components/ui/icon";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
import {
  type AskHistoryTurn,
  type AskSource,
  type AskStreamFrame,
  type DiagnoseDto,
  type DocumentChunkDto,
  type DocumentDto,
  type EmbeddingModelOption,
  type KBDto,
  type KBHealthDto,
  type KBStatsDto,
  type ScoredChunkDto,
  askKBStream,
  diagnoseSearch,
  getKBHealth,
  getStarterQuestions,
  getDocumentText,
  getKBStats,
  ingestUrl,
  listDocumentChunks,
  patchDocumentTags,
  suggestTagsForDocument,
  reembedAll,
  switchEmbeddingModel,
  reindexDocument,
  createKB,
  deleteDocument,
  listDocuments,
  listEmbeddingModels,
  listKBs,
  searchKB,
  updateRetrievalConfig,
  uploadDocument,
} from "@/lib/kb-api";

function makeStateFilters(t: ReturnType<typeof useTranslations>) {
  return [
    { value: "", label: t("toolbar.stateAll") },
    { value: "ready", label: t("toolbar.stateReady") },
    { value: "indexing", label: t("toolbar.stateIndexing") },
    { value: "failed", label: t("toolbar.stateFailed") },
  ];
}

const SECTION_LABEL =
  "font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle";

// ─────────────────────────────────────────────────────────────────────────────
// State pill — reuses semantic tokens
// ─────────────────────────────────────────────────────────────────────────────

function StatePill({ state }: { state: string }) {
  const cls =
    state === "ready"
      ? "border-success/30 bg-success-soft text-success"
      : state === "failed"
        ? "border-danger/30 bg-danger-soft text-danger"
        : "border-warning/30 bg-warning-soft text-warning";
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-2 font-mono text-[10px] uppercase tracking-wide ${cls}`}
    >
      {state}
    </span>
  );
}

const MIME_ICON: Record<string, { tone: string; label: string }> = {
  markdown: { tone: "text-primary", label: "MD" },
  "x-markdown": { tone: "text-primary", label: "MD" },
  pdf: { tone: "text-danger", label: "PDF" },
  html: { tone: "text-warning", label: "HTML" },
  plain: { tone: "text-text-muted", label: "TXT" },
  csv: { tone: "text-accent", label: "CSV" },
  json: { tone: "text-accent", label: "JSON" },
  "vnd.openxmlformats-officedocument.wordprocessingml.document": {
    tone: "text-primary",
    label: "DOCX",
  },
};

function isMarkdownLikely(mime: string): boolean {
  const sub = mime.split("/").pop() ?? "";
  // markdown / x-markdown / md / mdx — and we treat plain as markdown
  // because most things people upload as .txt are still markdown-ish.
  return /(markdown|^md$|^mdx$|plain|html)/.test(sub);
}

function MimeBadge({ mime }: { mime: string }) {
  const subtype = mime.split("/").pop() || mime;
  const meta = MIME_ICON[subtype] ?? { tone: "text-text-muted", label: subtype.slice(0, 4).toUpperCase() };
  return (
    <span
      className={`inline-flex h-7 w-9 items-center justify-center rounded-md border border-border bg-surface-2 font-mono text-[10px] font-semibold ${meta.tone}`}
    >
      {meta.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const t = useTranslations("knowledge");
  const [kbs, setKbs] = useState<KBDto[] | null>(null);
  const [activeKb, setActiveKb] = useState<KBDto | null>(null);
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [models, setModels] = useState<EmbeddingModelOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ScoredChunkDto[] | null>(null);
  // Ask mode (RAG QA) lives in the same query bar as search; toggle picks
  // which path to fire on Enter.
  const [mode, setMode] = useState<"search" | "ask">("search");
  // Multi-turn Ask state — each turn captures the user question, the
  // chunks retrieved for it, the streaming/final answer text, and per-turn
  // telemetry. ``streaming`` flips off when the SSE stream emits a `done`
  // (or `error`) frame; the UI uses that to swap the typing cursor for
  // citation chips.
  type AskTurn = {
    id: string;
    question: string;
    sources: AskSource[];
    answer: string;
    streaming: boolean;
    error: string | null;
    usedModel: string | null;
    latencyMs: number | null;
  };
  const [askTurns, setAskTurns] = useState<AskTurn[]>([]);
  const askAbortRef = useRef<AbortController | null>(null);
  // Starter questions cache, scoped to active KB id. Loaded lazily the
  // first time Ask mode is opened on a KB; nullable distinguishes
  // "not loaded yet" (skeleton) from "loaded but empty" (hide row).
  const [starters, setStarters] = useState<Record<string, string[] | null>>({});
  const startersForActive = activeKb ? (starters[activeKb.id] ?? null) : null;
  // KB health snapshot — refetched whenever activeKb changes or any
  // ingest/delete/tag patch could have shifted the totals. Sidebar card
  // tolerates `null` (renders skeleton) so we don't need a separate
  // loading flag.
  const [health, setHealth] = useState<Record<string, KBHealthDto | null>>({});
  const healthForActive = activeKb ? (health[activeKb.id] ?? null) : null;
  const [reembedBusy, setReembedBusy] = useState(false);
  async function runReembedAll() {
    if (!activeKb || reembedBusy) return;
    setReembedBusy(true);
    try {
      const res = await reembedAll(activeKb.id);
      setError(
        t("reembed.summary", {
          processed: res.processed,
          succeeded: res.succeeded,
          failed: res.failed,
        }),
      );
      setTimeout(() => setError(null), 4000);
      await refreshDocs(activeKb.id);
      await refreshKbs(activeKb);
    } catch (e) {
      setError(String(e));
    } finally {
      setReembedBusy(false);
    }
  }
  const [stateFilter, setStateFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageState, setPageState] = useState<"loading" | "ok" | "error">(
    "loading",
  );
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showUrlIngest, setShowUrlIngest] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocumentDto | null>(null);

  async function refreshKbs(preserve?: KBDto | null) {
    try {
      const data = await listKBs();
      setKbs(data);
      const target = preserve ? data.find((k) => k.id === preserve.id) : null;
      if (target) setActiveKb(target);
      else if (!activeKb && data[0]) setActiveKb(data[0]);
      setPageState("ok");
    } catch (e) {
      setError(String(e));
      setPageState("error");
    }
  }

  async function refreshDocs(kbId: string) {
    try {
      setDocs(await listDocuments(kbId, { limit: 200 }));
    } catch (e) {
      setError(String(e));
    }
    // Health depends on doc list — refetch in parallel; ignore errors so
    // a 500 on the analytics route can't crash the doc grid.
    void getKBHealth(kbId, 30)
      .then((h) => setHealth((prev) => ({ ...prev, [kbId]: h })))
      .catch(() => undefined);
  }

  useEffect(() => {
    void refreshKbs();
    listEmbeddingModels()
      .then(setModels)
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeKb) {
      void refreshDocs(activeKb.id);
      // Reset query state on KB switch
      setSearchQuery("");
      setCommittedQuery("");
      setResults(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKb?.id]);

  // Lazy-load starter questions the first time Ask mode is opened on a
  // KB. Backend caches by (kb, updated_at); refetching after an upload
  // is cheap. We *don't* prefetch on KB switch — saves an LLM call when
  // the user just wants to browse docs / search.
  useEffect(() => {
    if (!activeKb || mode !== "ask") return;
    if (starters[activeKb.id] !== undefined) return;
    const id = activeKb.id;
    setStarters((prev) => ({ ...prev, [id]: null }));
    void getStarterQuestions(id, 4)
      .then((qs) => setStarters((prev) => ({ ...prev, [id]: qs })))
      .catch(() => setStarters((prev) => ({ ...prev, [id]: [] })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKb?.id, mode]);

  function pickStarter(q: string) {
    setSearchQuery(q);
    void runAskTurn(q, false);
  }

  // Bulk upload — single file calls go through this too. Tracks per-file
  // status so the user can see N/M progress instead of one opaque spinner.
  type UploadEntry = {
    id: string;
    name: string;
    state: "queued" | "uploading" | "done" | "failed";
    error?: string;
  };
  const [uploads, setUploads] = useState<UploadEntry[]>([]);

  async function handleUploadFiles(files: FileList | File[]) {
    if (!activeKb) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    const entries: UploadEntry[] = list.map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      name: f.name,
      state: "queued",
    }));
    setUploads((prev) => [...entries, ...prev].slice(0, 20));
    setUploading(true);
    try {
      // Sequential upload — concurrent would race the SQLite writer lock
      // and embedder rate limits; one-at-a-time keeps the UI honest about
      // what's happening too.
      for (const e of entries) {
        const file = list[entries.indexOf(e)];
        if (!file) continue;
        setUploads((prev) =>
          prev.map((p) => (p.id === e.id ? { ...p, state: "uploading" } : p)),
        );
        try {
          await uploadDocument(activeKb.id, file, { title: file.name });
          setUploads((prev) =>
            prev.map((p) => (p.id === e.id ? { ...p, state: "done" } : p)),
          );
        } catch (err) {
          setUploads((prev) =>
            prev.map((p) =>
              p.id === e.id ? { ...p, state: "failed", error: String(err) } : p,
            ),
          );
        }
      }
      await refreshDocs(activeKb.id);
      await refreshKbs(activeKb);
    } finally {
      setUploading(false);
      // Clear done entries after 4s so panel doesn't accrete
      setTimeout(() => {
        setUploads((prev) => prev.filter((p) => p.state !== "done"));
      }, 4000);
    }
  }

  // Page-level drag-drop receiver
  const [dragOver, setDragOver] = useState(false);
  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!activeKb) return;
    e.preventDefault();
    e.stopPropagation();
    if (!dragOver) setDragOver(true);
  }
  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (
      e.currentTarget === e.target ||
      !e.currentTarget.contains(e.relatedTarget as Node)
    ) {
      setDragOver(false);
    }
  }
  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!activeKb || !e.dataTransfer.files.length) return;
    await handleUploadFiles(e.dataTransfer.files);
  }

  async function handleSearch() {
    if (!activeKb || !searchQuery.trim()) return;
    setSearching(true);
    setCommittedQuery(searchQuery.trim());
    setResults(null);
    setAskTurns([]);
    try {
      setResults(await searchKB(activeKb.id, searchQuery.trim()));
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  }

  // Run one Ask turn. ``followUp`` keeps existing turns + their context
  // window and appends a new turn; first-call mode resets the conversation.
  async function runAskTurn(question: string, followUp: boolean) {
    if (!activeKb || !question.trim()) return;
    const q = question.trim();
    setResults(null);
    setCommittedQuery(q);

    const history: AskHistoryTurn[] = followUp
      ? askTurns
          .filter((t) => !t.error && t.answer)
          .flatMap<AskHistoryTurn>((t) => [
            { role: "user", content: t.question },
            { role: "assistant", content: t.answer },
          ])
      : [];

    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const blank: AskTurn = {
      id: turnId,
      question: q,
      sources: [],
      answer: "",
      streaming: true,
      error: null,
      usedModel: null,
      latencyMs: null,
    };
    setAskTurns((prev) => (followUp ? [...prev, blank] : [blank]));

    // Cancel any prior in-flight stream — only one Ask at a time.
    askAbortRef.current?.abort();
    const ctl = new AbortController();
    askAbortRef.current = ctl;

    try {
      for await (const frame of askKBStream(activeKb.id, q, {
        topK: 5,
        history,
        signal: ctl.signal,
      })) {
        applyAskFrame(turnId, frame);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      applyAskFrame(turnId, { event: "error", message: String(e) });
    }
  }

  function applyAskFrame(turnId: string, frame: AskStreamFrame) {
    setAskTurns((prev) =>
      prev.map((t) => {
        if (t.id !== turnId) return t;
        switch (frame.event) {
          case "sources":
            return { ...t, sources: frame.sources };
          case "delta":
            return { ...t, answer: t.answer + frame.text };
          case "done":
            return {
              ...t,
              streaming: false,
              usedModel: frame.used_model,
              latencyMs: frame.latency_ms,
            };
          case "error":
            return { ...t, streaming: false, error: frame.message };
          default:
            return t;
        }
      }),
    );
  }

  async function handleAsk() {
    await runAskTurn(searchQuery, false);
  }

  async function handleAskFollowUp(q: string) {
    await runAskTurn(q, true);
  }

  function handleClearAsk() {
    askAbortRef.current?.abort();
    setAskTurns([]);
  }

  async function handleClearSearch() {
    askAbortRef.current?.abort();
    setSearchQuery("");
    setCommittedQuery("");
    setResults(null);
    setAskTurns([]);
  }

  async function handleDeleteDoc(d: DocumentDto) {
    if (!activeKb) return;
    if (!confirm(t("delete.confirm", { title: d.title }))) return;
    try {
      await deleteDocument(activeKb.id, d.id);
      setOpenDoc(null);
      await refreshDocs(activeKb.id);
      await refreshKbs(activeKb);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleReindexDoc(d: DocumentDto) {
    if (!activeKb) return;
    try {
      await reindexDocument(activeKb.id, d.id);
      await refreshDocs(activeKb.id);
      await refreshKbs(activeKb);
    } catch (e) {
      setError(String(e));
    }
  }

  // KB switcher options for the Select
  const kbSelectOptions = useMemo(
    () =>
      (kbs ?? []).map((k) => ({
        value: k.id,
        label: k.name,
        hint: t("toolbar.kbHint", { count: k.document_count }),
      })),
    [kbs, t],
  );

  // Document filter (state + tag)
  const filteredDocs = useMemo(() => {
    if (!docs) return [];
    return docs.filter((d) => {
      if (stateFilter && d.state !== stateFilter) return false;
      if (tagFilter && !d.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [docs, stateFilter, tagFilter]);

  // Selection helpers
  function toggleSelect(id: string) {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedDocs(new Set());
  }
  async function bulkDelete() {
    if (!activeKb || selectedDocs.size === 0) return;
    if (!confirm(t("delete.bulkConfirm", { count: selectedDocs.size }))) return;
    try {
      for (const id of selectedDocs) {
        await deleteDocument(activeKb.id, id);
      }
      clearSelection();
      await refreshDocs(activeKb.id);
      await refreshKbs(activeKb);
    } catch (e) {
      setError(String(e));
    }
  }

  // Bulk tag editor state — popover open over the selection bar.
  // Patches each selected doc independently; per-doc errors are tolerated
  // (failures show in the page error banner rather than aborting mid-loop).
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  async function applyBulkTags(addList: string[], removeList: string[]) {
    if (!activeKb) return;
    setBulkTagOpen(false);
    if (addList.length === 0 && removeList.length === 0) return;
    const failures: string[] = [];
    for (const id of selectedDocs) {
      try {
        await patchDocumentTags(activeKb.id, id, {
          add: addList.length ? addList : undefined,
          remove: removeList.length ? removeList : undefined,
        });
      } catch (e) {
        failures.push(`${id.slice(0, 8)}: ${e}`);
      }
    }
    if (failures.length > 0) {
      setError(`Bulk tag · ${failures.length} failed:\n${failures.join("\n")}`);
    }
    clearSelection();
    await refreshDocs(activeKb.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div
        className={`relative flex h-full flex-col gap-4 p-6 ${
          dragOver
            ? "outline-dashed outline-2 outline-primary outline-offset-[-12px]"
            : ""
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
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

        {/* ─ Stale embedding banner — shown when at least one chunk in
            the active KB has no vector. Lets the user one-click backfill
            without touching individual docs. */}
        {activeKb && (healthForActive?.chunks_missing_embeddings ?? 0) > 0 && (
          <StaleEmbeddingBanner
            missing={healthForActive?.chunks_missing_embeddings ?? 0}
            chunkTotal={healthForActive?.chunk_count ?? 0}
            busy={reembedBusy}
            onReembed={runReembedAll}
          />
        )}

        {/* ─ Toolbar */}
        {pageState === "ok" && (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={activeKb?.id ?? ""}
              onChange={(v) => {
                const k = kbs?.find((x) => x.id === v);
                if (k) setActiveKb(k);
              }}
              options={kbSelectOptions}
              placeholder={t("toolbar.kbSelectPlaceholder")}
              className="min-w-[200px]"
              triggerClassName="h-9 rounded-xl"
              ariaLabel={t("toolbar.kbSelectAria")}
            />
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
              aria-label={t("toolbar.newKbAria")}
            >
              <Icon name="plus" size={13} />
              <span>{t("toolbar.newKb")}</span>
            </button>

            {/* Search / Ask bar */}
            <div className="relative ml-auto flex min-w-[340px] flex-1 max-w-[720px] items-center gap-2">
              {/* Mode toggle (segmented) */}
              <div className="inline-flex h-9 items-center rounded-xl border border-border bg-surface p-0.5">
                {(["search", "ask"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[11px] font-medium transition duration-fast ${
                      mode === m
                        ? "bg-primary text-primary-fg shadow-soft-sm"
                        : "text-text-muted hover:text-text"
                    }`}
                    title={m === "search" ? t("toolbar.modeSearchTitle") : t("toolbar.modeAskTitle")}
                  >
                    <Icon name={m === "search" ? "search" : "sparkles"} size={11} />
                    {m === "search" ? t("toolbar.modeSearch") : t("toolbar.modeAsk")}
                  </button>
                ))}
              </div>
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void (mode === "ask" ? handleAsk() : handleSearch());
                    }
                    if (e.key === "Escape") void handleClearSearch();
                  }}
                  placeholder={
                    !activeKb
                      ? t("toolbar.searchPlaceholderPick")
                      : mode === "ask"
                        ? t("toolbar.askPlaceholder", { kb: activeKb.name })
                        : t("toolbar.searchInside", { kb: activeKb.name })
                  }
                  disabled={!activeKb}
                  className="h-9 w-full rounded-xl border border-border bg-surface pl-3 pr-20 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none disabled:opacity-50"
                />
                {committedQuery && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    className="absolute right-14 top-1/2 -translate-y-1/2 text-[11px] text-text-subtle hover:text-text"
                    aria-label={t("toolbar.clearSearchAria")}
                  >
                    ✕
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    mode === "ask" ? void handleAsk() : void handleSearch()
                  }
                  disabled={
                    (mode === "ask" ? askTurns.some((t) => t.streaming) : searching) ||
                    !searchQuery.trim() ||
                    !activeKb
                  }
                  className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-7 items-center rounded-lg bg-primary px-3 text-[11px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40 transition duration-fast"
                >
                  {(mode === "ask"
                    ? askTurns.some((t) => t.streaming)
                    : searching)
                    ? t("toolbar.submitRunning")
                    : mode === "ask"
                      ? t("toolbar.submitAsk")
                      : t("toolbar.submitSearch")}
                </button>
              </div>
            </div>

            <AddDocumentMenu
              disabled={!activeKb || uploading}
              uploading={uploading}
              onPickFiles={(files) => void handleUploadFiles(files)}
              onPickUrl={() => activeKb && setShowUrlIngest(true)}
            />
          </div>
        )}

        {/* Upload progress strip — pin under toolbar so user sees what's
            happening with bulk drops */}
        {uploads.length > 0 && (
          <UploadProgressStrip
            uploads={uploads}
            onClear={() => setUploads([])}
          />
        )}

        {/* Drag-drop hint overlay — only when dragging files in */}
        {dragOver && activeKb && (
          <div
            className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center"
            aria-hidden="true"
          >
            <div className="rounded-2xl border border-primary bg-surface px-8 py-6 text-center shadow-soft-lg">
              <Icon
                name="upload"
                size={28}
                className="mx-auto mb-2 text-primary"
              />
              <div className="text-[14px] font-semibold text-text">
                {t("dragOverlay.drop", { kb: activeKb.name })}
              </div>
              <div className="font-mono text-[11px] text-text-subtle">
                {t("dragOverlay.supportedFormats")}
              </div>
            </div>
          </div>
        )}

        {/* ─ Body */}
        <div className="grid flex-1 grid-cols-12 gap-4 overflow-hidden">
          {/* ─ Left aside */}
          <aside className="col-span-12 flex min-h-0 flex-col gap-3 overflow-y-auto lg:col-span-3">
            {pageState === "loading" && (
              <LoadingState title={t("sidebar.loadingTitle")} description={t("sidebar.loadingDesc")} />
            )}
            {pageState === "error" && (
              <ErrorState title={error || t("loadFailed")} />
            )}
            {pageState === "ok" && activeKb && (
              <>
                <KBInfoCard
                  kb={activeKb}
                  onOpenSettings={() => setShowSettings(true)}
                />
                <KBHealthCard health={healthForActive} />
                <TagsCard
                  docs={docs ?? []}
                  active={tagFilter}
                  onPick={setTagFilter}
                />
                <ToolsCard />
              </>
            )}
            {pageState === "ok" && !activeKb && kbs && kbs.length === 0 && (
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className={SECTION_LABEL}>{t("sidebar.startLabel")}</div>
                <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
                  {t("sidebar.startDesc")}
                </p>
              </div>
            )}
          </aside>

          {/* ─ Main canvas */}
          <main className="col-span-12 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface lg:col-span-9">
            {pageState === "ok" && !activeKb && kbs && kbs.length === 0 ? (
              <OnboardingWizard
                models={models}
                onCreate={() => setShowCreate(true)}
              />
            ) : pageState === "ok" && !activeKb ? (
              <div className="flex h-full items-center justify-center px-6 py-12 text-[12px] text-text-muted">
                {t("sidebar.pickKbHint")}
              </div>
            ) : pageState !== "ok" ? null : askTurns.length > 0 ? (
              <AskAnswerView
                turns={askTurns}
                onFollowUp={handleAskFollowUp}
                onClear={handleClearAsk}
                onChunkClick={(docId) => {
                  const d = docs?.find((x) => x.id === docId);
                  if (d) setOpenDoc(d);
                }}
              />
            ) : committedQuery ? (
              <SearchResultsView
                query={committedQuery}
                results={results}
                searching={searching}
                onChunkClick={(docId) => {
                  const d = docs?.find((x) => x.id === docId);
                  if (d) setOpenDoc(d);
                }}
              />
            ) : (
              <DocumentsView
                docs={filteredDocs}
                allDocsCount={docs?.length ?? 0}
                hasFilter={!!stateFilter || !!tagFilter}
                onClickDoc={setOpenDoc}
                onUpload={() => {
                  setError(t("uploadHint"));
                  setTimeout(() => setError(null), 2500);
                }}
                onReindex={handleReindexDoc}
                selected={selectedDocs}
                onToggleSelect={toggleSelect}
                onClearSelection={clearSelection}
                onBulkDelete={bulkDelete}
                onBulkTagsClick={() => setBulkTagOpen(true)}
                tagFilter={tagFilter}
                onClearTagFilter={() => setTagFilter(null)}
                starters={mode === "ask" ? startersForActive : null}
                onPickStarter={pickStarter}
                stateFilter={stateFilter}
                onChangeStateFilter={setStateFilter}
              />
            )}
          </main>
        </div>

        {/* ─ Slide-over: Document detail */}
        {openDoc && activeKb && (
          <DocDrawer
            doc={openDoc}
            kbId={activeKb.id}
            onClose={() => setOpenDoc(null)}
            onDelete={handleDeleteDoc}
            onTagsChanged={async () => {
              if (!activeKb) return;
              await refreshDocs(activeKb.id);
              // Pull the freshly-tagged version back into the drawer state
              const refreshed = (await listDocuments(activeKb.id, { limit: 200 })).find(
                (d) => d.id === openDoc.id,
              );
              if (refreshed) setOpenDoc(refreshed);
            }}
          />
        )}

        {/* ─ Modal: Bulk-tag selected docs */}
        {bulkTagOpen && activeKb && (
          <BulkTagModal
            knownTags={Array.from(
              new Set((docs ?? []).flatMap((d) => d.tags)),
            ).sort()}
            selectionCount={selectedDocs.size}
            onClose={() => setBulkTagOpen(false)}
            onApply={applyBulkTags}
          />
        )}

        {/* ─ Modal: Create KB */}
        {showUrlIngest && activeKb && (
          <UrlIngestModal
            kb={activeKb}
            onClose={() => setShowUrlIngest(false)}
            onIngested={async () => {
              setShowUrlIngest(false);
              await refreshDocs(activeKb.id);
              await refreshKbs(activeKb);
            }}
            onError={setError}
          />
        )}
        {showCreate && (
          <CreateKBModal
            models={models}
            onClose={() => setShowCreate(false)}
            onCreated={async (kb) => {
              setShowCreate(false);
              await refreshKbs(kb);
            }}
            onError={setError}
          />
        )}

        {/* ─ Modal: KB settings (basic + advanced + danger) */}
        {showSettings && activeKb && (
          <KBSettingsModal
            kb={activeKb}
            models={models}
            onClose={() => setShowSettings(false)}
            onSaved={async (next) => {
              setShowSettings(false);
              await refreshKbs(next);
            }}
            onDelete={async () => {
              setShowSettings(false);
              try {
                const { deleteKB } = await import("@/lib/kb-api");
                await deleteKB(activeKb.id);
                setActiveKb(null);
                await refreshKbs();
              } catch (e) {
                setError(String(e));
              }
            }}
            onError={setError}
          />
        )}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar cards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * KB info card · user perspective · no BM25/RRF/dim/cosine jargon.
 *
 * Three layers:
 *   1. Name + description + settings entry
 *   2. One-line capability summary (e.g. semantic search on / demo mode warning)
 *   3. Numbers: "5 snippets · from 2 sources"
 *
 * Retrieval weights / embedder dim and other technical details are tucked
 * into the "Advanced" tab of the settings dialog.
 */
function KBInfoCard({
  kb,
  onOpenSettings,
}: {
  kb: KBDto;
  onOpenSettings: () => void;
}) {
  const t = useTranslations("knowledge.kb");
  const isMock = kb.embedding_model_ref.startsWith("mock:");
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-text">
            {kb.name}
          </div>
          {kb.description && (
            <div className="mt-0.5 line-clamp-2 text-[12px] text-text-muted">
              {kb.description}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={t("settingsAria")}
          title={t("settingsTitle")}
          className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-surface text-text-subtle hover:border-border-strong hover:text-text transition duration-fast"
        >
          <Icon name="settings" size={12} />
        </button>
      </div>

      {/* Content stats — friendly wording, no documents/chunks jargon */}
      <div className="mt-3 flex items-baseline gap-3 text-[13px] text-text">
        <span>
          <span className="font-semibold">{kb.document_count}</span>
          <span className="ml-1 text-text-muted">{t("docCountUnit")}</span>
        </span>
        <span className="text-text-subtle">·</span>
        <span>
          <span className="font-semibold">{kb.chunk_count}</span>
          <span className="ml-1 text-text-muted">{t("chunkCountUnit")}</span>
        </span>
      </div>

      {/* Capability hint — mock surfaces a warning; real providers stay quiet */}
      {isMock ? (
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-3 block w-full rounded-lg border border-warning/40 bg-warning-soft p-3 text-left text-[12px] text-warning hover:bg-warning/10 transition duration-fast"
        >
          <div className="flex items-center gap-1.5 font-medium">
            <Icon name="alert-triangle" size={12} />
            <span>{t("demoMode")}</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed">
            {t("demoModeDetail")}
            <span className="underline">{t("demoModeCta")}</span>
          </p>
        </button>
      ) : (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-[12px] text-success">
          <Icon name="check" size={12} />
          <span>{t("semanticEnabled")}</span>
        </div>
      )}
    </div>
  );
}

// Stale embedding banner — fires when KB.health.chunks_missing_embeddings
// > 0. Common cause: user ingested docs while the embedding provider
// was misconfigured (missing API key) so chunk.embedding stayed NULL.
// One-click backfill that re-runs the ingest pipeline for every doc.
function StaleEmbeddingBanner({
  missing,
  chunkTotal,
  busy,
  onReembed,
}: {
  missing: number;
  chunkTotal: number;
  busy: boolean;
  onReembed: () => void | Promise<void>;
}) {
  const t = useTranslations("knowledge.stale");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-2.5 text-[12px] text-warning">
      <div className="flex items-center gap-2">
        <Icon name="alert-triangle" size={13} />
        <span className="text-text">
          {t("body", { missing, total: chunkTotal })}
        </span>
      </div>
      <button
        type="button"
        onClick={() => void onReembed()}
        disabled={busy}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-warning/40 bg-surface px-2.5 text-[11px] font-medium text-text hover:border-warning hover:text-warning disabled:opacity-40"
      >
        <Icon name="refresh" size={11} />
        {busy ? t("running") : t("cta")}
      </button>
    </div>
  );
}

// KB health card — sidebar 第二张卡。Snapshot of "what's in here / when
// did I last touch it". Three rows: KPI numbers · 30-day sparkline of doc
// ingest activity · top tags & dominant mime. No real-time polling — the
// page-level refreshDocs() pull also bumps health.
function KBHealthCard({ health }: { health: KBHealthDto | null }) {
  const t = useTranslations("knowledge.health");
  if (!health) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className={SECTION_LABEL}>{t("sectionLabel")}</div>
        <div className="mt-3 h-16 animate-pulse rounded-lg bg-surface-2" />
      </div>
    );
  }

  const lastActivity = health.last_activity
    ? formatRelativeTime(new Date(health.last_activity))
    : t("never");
  const tokenLabel = formatCompact(health.token_sum);
  const sparkMax = Math.max(1, ...health.daily_doc_counts.map((d) => d.count));
  const dominantMime = health.mime_breakdown[0];

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className={SECTION_LABEL}>{t("sectionLabel")}</div>
        <span
          className="font-mono text-[10px] text-text-subtle"
          title={health.last_activity ?? undefined}
        >
          {t("lastActivity", { when: lastActivity })}
        </span>
      </div>

      {/* KPI row */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <KpiCell
          label={t("docs")}
          value={health.doc_count.toString()}
        />
        <KpiCell
          label={t("chunks")}
          value={formatCompact(health.chunk_count)}
        />
        <KpiCell label={t("tokens")} value={tokenLabel} />
      </div>

      {/* Sparkline */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-text-subtle">
          <span>{t("activityHeader", { days: health.daily_doc_counts.length })}</span>
          <span>{t("activityHint")}</span>
        </div>
        <Sparkline
          data={health.daily_doc_counts.map((d) => d.count)}
          max={sparkMax}
        />
      </div>

      {/* Top tags row */}
      {health.top_tags.length > 0 && (
        <div className="mt-3">
          <div className={SECTION_LABEL}>{t("topTagsHeader")}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {health.top_tags.map((tg) => (
              <span
                key={tg.tag}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-muted"
              >
                #{tg.tag}
                <span className="text-text-subtle">·{tg.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {dominantMime && (
        <div className="mt-3 font-mono text-[10px] text-text-subtle">
          {t("dominantMime", {
            mime: dominantMime.mime.split("/").pop() ?? dominantMime.mime,
            count: dominantMime.count,
          })}
        </div>
      )}
    </div>
  );
}

function KpiCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-2 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-text-subtle">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[14px] font-semibold text-text">
        {value}
      </div>
    </div>
  );
}

// Tiny SVG sparkline — bars (not line) because "doc count per day" is
// discrete + often zero. Bar width auto-scales to fit container; bar
// height clamped to ≥ 2px so single-doc days are still visible. Days
// with zero docs render as faint baseline for visual rhythm.
function Sparkline({ data, max }: { data: number[]; max: number }) {
  const W = 100;
  const H = 24;
  const barW = W / Math.max(1, data.length);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-7 w-full"
      aria-hidden="true"
    >
      {data.map((v, i) => {
        const h = v === 0 ? 1 : Math.max(2, (v / max) * H);
        const x = i * barW;
        const y = H - h;
        const fill = v === 0 ? "var(--color-border)" : "var(--color-primary)";
        return (
          <rect
            key={i}
            x={x + 0.3}
            y={y}
            width={Math.max(0.5, barW - 0.6)}
            height={h}
            fill={fill}
            rx="0.5"
          />
        );
      })}
    </svg>
  );
}

function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatRelativeTime(d: Date): string {
  // Locale-neutral: returns short tokens the calling i18n context wraps
  // for display. Keeping this as plain strings (no Chinese in source)
  // avoids the i18n-no-hardcoded-zh contract while still being readable
  // for ops debugging.
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  return d.toISOString().slice(0, 10);
}

function TagsCard({
  docs,
  active,
  onPick,
}: {
  docs: DocumentDto[];
  active: string | null;
  onPick: (t: string | null) => void;
}) {
  const tt = useTranslations("knowledge.tags");
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of docs) {
      for (const t of d.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [docs]);
  if (tags.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className={SECTION_LABEL}>{tt("sectionLabel")}</span>
        {active && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="text-[11px] text-text-subtle hover:text-text"
          >
            {tt("clear")}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map(([t, n]) => {
          const isActive = active === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onPick(isActive ? null : t)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition duration-fast ${
                isActive
                  ? "border-primary bg-primary-muted text-primary"
                  : "border-border bg-surface-2 text-text-muted hover:border-border-strong hover:text-text"
              }`}
            >
              <span>#{t}</span>
              <span className="font-mono text-[10px] text-text-subtle">{n}</span>
            </button>
          );
        })}
      </div>
      {/* Suppress the original span loop — replaced with the buttons above */}
      <div className="hidden">
        {tags.map(([t, n]) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted"
          >
            <span>#{t}</span>
            <span className="font-mono text-[10px] text-text-subtle">{n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ToolsCard() {
  const t = useTranslations("knowledge.tools");
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text">
        <Icon name="users" size={13} className="text-primary" />
        {t("title")}
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-text-muted">
        {t.rich("body", {
          emp: (chunks) => <span className="text-text">{chunks}</span>,
        })}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding wizard (zero-KB state)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full-page first-run experience. Notion / ChatGPT custom-GPT do this:
 * give the user a numbered "here's how to start" guide plus the primary
 * action prominent. Avoids the "blank canvas where do I click" anxiety.
 */
function OnboardingWizard({
  models,
  onCreate,
}: {
  models: EmbeddingModelOption[];
  onCreate: () => void;
}) {
  const t = useTranslations("knowledge.onboarding");
  const realAvailable = models.filter(
    (m) => !m.ref.startsWith("mock:") && m.available,
  ).length;
  const steps = [
    {
      n: 1,
      title: t("step1Title"),
      done: realAvailable > 0,
      cta: realAvailable > 0
        ? t("step1Found", { count: realAvailable })
        : t("step1NotFound"),
      action: realAvailable === 0
        ? { href: "/gateway", label: t("step1Action") }
        : undefined,
      desc: t("step1Desc"),
    },
    {
      n: 2,
      title: t("step2Title"),
      done: false,
      cta: undefined,
      action: { onClick: onCreate, label: t("step2Action") },
      desc: t("step2Desc"),
    },
    {
      n: 3,
      title: t("step3Title"),
      done: false,
      cta: undefined,
      action: undefined,
      desc: t("step3Desc"),
    },
    {
      n: 4,
      title: t("step4Title"),
      done: false,
      cta: undefined,
      action: { href: "/employees", label: t("step4Action") },
      desc: t("step4Desc"),
    },
  ];
  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary-muted">
            <Icon name="book-open" size={26} className="text-primary" />
          </div>
          <h2 className="text-[20px] font-semibold text-text">{t("heading")}</h2>
          <p className="mt-1 text-[13px] text-text-muted">
            {t("subtitle")}
          </p>
        </div>
        <ol className="space-y-3">
          {steps.map((s) => (
            <li
              key={s.n}
              className="flex gap-3 rounded-xl border border-border bg-surface-2 p-4"
            >
              <div
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg font-mono text-[12px] ${
                  s.done
                    ? "bg-success-soft text-success"
                    : "bg-primary-muted text-primary"
                }`}
              >
                {s.done ? <Icon name="check" size={14} /> : s.n}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
                  {s.title}
                  {s.cta && (
                    <span className="font-mono text-[10px] text-text-subtle">
                      · {s.cta}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
                  {s.desc}
                </p>
                {s.action && "href" in s.action ? (
                  <a
                    href={s.action.href}
                    className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text"
                  >
                    {s.action.label}
                    <Icon name="external-link" size={11} />
                  </a>
                ) : s.action ? (
                  <button
                    type="button"
                    onClick={s.action.onClick}
                    className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-fg hover:bg-primary-hover"
                  >
                    <Icon name="plus" size={11} />
                    {s.action.label}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-5 text-[13px] font-semibold text-primary-fg shadow-soft-sm hover:bg-primary-hover transition duration-fast"
          >
            <Icon name="plus" size={14} />
            {t("primaryCta")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add-document split button — replaces the legacy "Upload" + "抓 URL"
// double-button. Primary click on the left "Upload" half opens a file
// picker; chevron half opens a small menu with "Upload files" / "Ingest
// URL" entries. One control instead of two halves the toolbar density
// without removing functionality.
// ─────────────────────────────────────────────────────────────────────────────

function AddDocumentMenu({
  disabled,
  uploading,
  onPickFiles,
  onPickUrl,
}: {
  disabled: boolean;
  uploading: boolean;
  onPickFiles: (files: FileList) => void;
  onPickUrl: () => void;
}) {
  const t = useTranslations("knowledge.toolbar");
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Click-away closer — keeps the popover ephemeral. Mousedown vs click
  // chosen so dragging from a primary click doesn't snap the menu shut.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Flip menu side when too close to the bottom — the toolbar usually
  // sits near the top so "bottom" is the common case, but we still need
  // top-full as a fallback per § 3.9 popover contract.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setSide(computePopoverSide(rect, 80, window.innerHeight, "bottom"));
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <label
        className={`inline-flex h-9 items-center gap-1.5 rounded-l-xl px-3 text-[12px] font-medium text-primary-fg shadow-soft-sm transition duration-fast ${
          disabled
            ? "bg-primary opacity-40 cursor-not-allowed"
            : "bg-primary hover:bg-primary-hover cursor-pointer"
        }`}
      >
        <Icon name="upload" size={13} />
        {uploading ? t("uploading") : t("upload")}
        <input
          type="file"
          multiple
          disabled={disabled}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onPickFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />
      </label>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-9 items-center justify-center rounded-r-xl border-l border-primary-fg/20 px-2 text-primary-fg shadow-soft-sm transition duration-fast ${
          disabled
            ? "bg-primary opacity-40 cursor-not-allowed"
            : "bg-primary hover:bg-primary-hover"
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="chevron-down" size={12} />
      </button>
      {open && (
        <div
          className={`absolute right-0 z-40 w-48 overflow-hidden rounded-xl border border-border bg-surface shadow-soft-lg ${
            side === "bottom" ? "top-full mt-1" : "bottom-full mb-1"
          }`}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onPickUrl();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text hover:bg-surface-2"
          >
            <Icon name="link" size={13} className="text-text-subtle" />
            {t("ingestUrl")}
          </button>
        </div>
      )}
    </div>
  );
}

// Inline state filter for the Documents header — was a top-toolbar
// Select before the layout pass; moved here because it's only meaningful
// in the doc-grid context (search / Ask views already filter by relevance).
function DocStateSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("knowledge");
  return (
    <Select
      value={value}
      onChange={onChange}
      options={makeStateFilters(t)}
      className="min-w-[112px]"
      triggerClassName="h-7 rounded-lg text-[11px]"
      ariaLabel={t("toolbar.stateFilterAria")}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Starter chips — LLM-suggested first questions, shown when Ask mode is
// idle. Mirrors NotebookLM's "Suggested questions" strip and ChatGPT's
// custom-GPT example prompts. Empty list (no docs / no provider) renders
// nothing so the layout collapses cleanly.
// ─────────────────────────────────────────────────────────────────────────────

function StarterChips({
  starters,
  onPick,
}: {
  starters: string[];
  onPick: (q: string) => void;
}) {
  const t = useTranslations("knowledge.starters");
  return (
    <div className="border-b border-border bg-gradient-to-b from-primary-muted/30 to-transparent px-5 py-4">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-primary">
        <Icon name="sparkles" size={11} />
        <span>{t("label")}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {starters.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="group inline-flex items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-[12px] text-text-muted hover:border-primary/40 hover:bg-primary-muted/40 hover:text-text transition duration-fast"
          >
            <Icon
              name="message-square"
              size={12}
              className="mt-0.5 text-text-subtle group-hover:text-primary"
            />
            <span className="max-w-[280px] leading-snug">{q}</span>
          </button>
        ))}
      </div>
      <div className="mt-1.5 font-mono text-[10px] text-text-subtle">
        {t("hint")}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents view (idle)
// ─────────────────────────────────────────────────────────────────────────────

function DocumentsView({
  docs,
  allDocsCount,
  hasFilter,
  onClickDoc,
  onUpload,
  onReindex,
  selected,
  onToggleSelect,
  onClearSelection,
  onBulkDelete,
  onBulkTagsClick,
  tagFilter,
  onClearTagFilter,
  starters,
  onPickStarter,
  stateFilter,
  onChangeStateFilter,
}: {
  docs: DocumentDto[];
  allDocsCount: number;
  hasFilter: boolean;
  onClickDoc: (d: DocumentDto) => void;
  onUpload: () => void;
  onReindex: (d: DocumentDto) => Promise<void>;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onClearSelection: () => void;
  onBulkDelete: () => Promise<void>;
  onBulkTagsClick: () => void;
  tagFilter: string | null;
  onClearTagFilter: () => void;
  starters: string[] | null;
  onPickStarter: (q: string) => void;
  stateFilter: string;
  onChangeStateFilter: (v: string) => void;
}) {
  const t = useTranslations("knowledge.docs");
  if (allDocsCount === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12">
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDesc")}
          action={{
            label: t("emptyAction"),
            onClick: onUpload,
            icon: "upload",
          }}
          icon="book-open"
        />
      </div>
    );
  }
  if (docs.length === 0 && hasFilter) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-12 text-[12px] text-text-muted">
        {t("noFilterMatch")}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {starters && starters.length > 0 && (
        <StarterChips starters={starters} onPick={onPickStarter} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <div className={SECTION_LABEL}>{t("sectionLabel")}</div>
          <span className="font-mono text-[10px] text-text-subtle">
            {t("countOf", { visible: docs.length, total: allDocsCount })}
          </span>
          <DocStateSelect value={stateFilter} onChange={onChangeStateFilter} />
          {tagFilter && (
            <button
              type="button"
              onClick={onClearTagFilter}
              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary-muted px-2 py-0.5 text-[11px] text-primary"
              title={t("removeTagFilter")}
            >
              #{tagFilter} ✕
            </button>
          )}
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-muted">
              {t("selectedCount", { count: selected.size })}
            </span>
            <button
              type="button"
              onClick={onClearSelection}
              className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2 text-[11px] text-text-muted hover:text-text"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={onBulkTagsClick}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text"
            >
              <Icon name="tag" size={11} />
              {t("bulkTags")}
            </button>
            <button
              type="button"
              onClick={() => void onBulkDelete()}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-danger/40 bg-danger-soft px-2 text-[11px] text-danger hover:bg-danger/10"
            >
              <Icon name="trash-2" size={11} />
              {t("bulkDelete")}
            </button>
          </div>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2 xl:grid-cols-3">
        {docs.map((d) => {
          const isSelected = selected.has(d.id);
          return (
          <div
            key={d.id}
            className={`group relative flex cursor-pointer flex-col gap-2 rounded-xl border bg-surface-2 p-3 text-left transition duration-fast hover:-translate-y-px hover:shadow-soft-sm ${
              isSelected
                ? "border-primary ring-1 ring-primary/30"
                : "border-border hover:border-border-strong"
            }`}
            onClick={() => onClickDoc(d)}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(d.id);
              }}
              className={`absolute left-2 top-2 grid h-5 w-5 place-items-center rounded border transition duration-fast ${
                isSelected
                  ? "border-primary bg-primary text-primary-fg opacity-100"
                  : "border-border bg-surface text-transparent opacity-0 group-hover:opacity-100 hover:border-border-strong"
              }`}
              aria-label={t("selectAria")}
            >
              <Icon name="check" size={12} />
            </button>
            <div className="flex items-start justify-between gap-2">
              <MimeBadge mime={d.mime_type} />
              <StatePill state={d.state} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-text group-hover:text-text">
                {d.title}
              </div>
              {d.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {d.tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-subtle"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between font-mono text-[10px] text-text-subtle">
              <span>
                {"\u{1F9E9} "}
                {t("chunkSummary", { chunks: d.chunk_count, version: d.version })}
              </span>
              <span>{t("sizeKb", { kb: (d.size_bytes / 1024).toFixed(1) })}</span>
            </div>
            {d.state_error && (
              <div className="rounded-md border border-danger/30 bg-danger-soft px-2 py-1 text-[10px] text-danger">
                {d.state_error}
              </div>
            )}
            {d.state === "failed" && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  void onReindex(d);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    void onReindex(d);
                  }
                }}
                className="inline-flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-warning/40 bg-warning-soft px-2 text-[11px] text-warning hover:bg-warning/10 transition duration-fast"
              >
                <Icon name="refresh" size={11} />
                {t("retryIngest")}
              </span>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload progress strip
// ─────────────────────────────────────────────────────────────────────────────

function UploadProgressStrip({
  uploads,
  onClear,
}: {
  uploads: Array<{
    id: string;
    name: string;
    state: "queued" | "uploading" | "done" | "failed";
    error?: string;
  }>;
  onClear: () => void;
}) {
  const t = useTranslations("knowledge.uploads");
  const done = uploads.filter((u) => u.state === "done").length;
  const failed = uploads.filter((u) => u.state === "failed").length;
  const inflight = uploads.filter(
    (u) => u.state === "queued" || u.state === "uploading",
  ).length;

  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px]">
          <Icon name="upload" size={12} className="text-primary" />
          <span className="text-text">
            {t("summary", { done, total: uploads.length })}
            {failed > 0 && (
              <span className="ml-2 text-danger">{t("failed", { count: failed })}</span>
            )}
            {inflight > 0 && (
              <span className="ml-2 text-warning">{t("inflight", { count: inflight })}</span>
            )}
          </span>
        </div>
        {inflight === 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-text-subtle hover:text-text"
          >
            {t("clear")}
          </button>
        )}
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {uploads.slice(0, 6).map((u) => {
          const tone =
            u.state === "done"
              ? "text-success"
              : u.state === "failed"
                ? "text-danger"
                : "text-warning";
          const icon =
            u.state === "done"
              ? "check"
              : u.state === "failed"
                ? "alert-triangle"
                : "loader";
          return (
            <li
              key={u.id}
              className="flex items-center gap-1.5 truncate font-mono text-[10px] text-text-muted"
              title={u.error || u.name}
            >
              <Icon
                name={icon}
                size={10}
                className={`${tone} ${u.state === "uploading" ? "animate-spin" : ""}`}
              />
              <span className="truncate">{u.name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ask (RAG) answer view — Glean / Perplexity style
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders the LLM answer with inline cite chips. The model output uses
 * "[1]", "[2]" markers; we replace them with clickable buttons that open
 * the referenced source card. The full sources list sits below the answer
 * (Perplexity's "sources strip" + Cohere Coral's footnote pattern).
 */
type AskTurnView = {
  id: string;
  question: string;
  sources: AskSource[];
  answer: string;
  streaming: boolean;
  error: string | null;
  usedModel: string | null;
  latencyMs: number | null;
};

function AskAnswerView({
  turns,
  onFollowUp,
  onClear,
  onChunkClick,
}: {
  turns: AskTurnView[];
  onFollowUp: (q: string) => void | Promise<void>;
  onClear: () => void;
  onChunkClick: (docId: string) => void;
}) {
  const t = useTranslations("knowledge.ask");
  const [followUpDraft, setFollowUpDraft] = useState("");
  const tail = turns[turns.length - 1];
  const anyStreaming = turns.some((tt) => tt.streaming);

  // Auto-scroll the conversation pane so the latest delta stays in view
  // while streaming. Skipped when the user manually scrolls up (sentinel
  // is the last turn — IntersectionObserver would over-engineer this).
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  function submitFollowUp() {
    const q = followUpDraft.trim();
    if (!q || anyStreaming) return;
    setFollowUpDraft("");
    void onFollowUp(q);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header — single bar carries conversation length + clear control */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Icon name="sparkles" size={13} className="text-primary" />
          <div className={SECTION_LABEL}>{t("answerLabel")}</div>
          <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text">
            {t("turnsLabel", { count: turns.length })}
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-text-subtle">
          {tail?.usedModel && <span>{tail.usedModel}</span>}
          {tail?.latencyMs !== null && tail?.latencyMs !== undefined && (
            <>
              <span>·</span>
              <span>{tail.latencyMs.toFixed(0)} ms</span>
            </>
          )}
          <button
            type="button"
            onClick={onClear}
            className="ml-2 inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[10px] uppercase tracking-wider text-text-muted hover:border-border-strong hover:text-text"
            disabled={anyStreaming}
          >
            <Icon name="refresh" size={10} />
            {t("newConversation")}
          </button>
        </div>
      </div>

      {/* Scrolling conversation log */}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <ul className="space-y-6">
          {turns.map((turn, idx) => (
            <li key={turn.id} className="space-y-3">
              {/* User question bubble — kept compact, right-aligned-feeling
                  but still left-anchored for legibility */}
              <div className="flex items-start gap-2.5">
                <div className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-muted text-primary">
                  <Icon name="user" size={11} />
                </div>
                <div className="flex-1">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
                    {t("youAskedLabel", { n: idx + 1 })}
                  </div>
                  <p className="mt-1 text-[14px] leading-snug text-text">
                    {turn.question}
                  </p>
                </div>
              </div>

              {/* Answer bubble */}
              <div className="flex items-start gap-2.5">
                <div className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-primary">
                  <Icon name="sparkles" size={11} />
                </div>
                <div className="flex-1 space-y-3">
                  <AskTurnAnswer
                    turn={turn}
                    onChunkClick={onChunkClick}
                  />
                  {turn.sources.length > 0 && (
                    <AskTurnSources turn={turn} onChunkClick={onChunkClick} />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Follow-up composer — pinned bottom; mirrors a chat input but
          only fires the Ask path. Disabled while a turn is mid-stream
          to keep server-side ordering simple. */}
      <div className="border-t border-border bg-surface px-5 py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={followUpDraft}
            onChange={(e) => setFollowUpDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitFollowUp();
              }
            }}
            placeholder={t("followUpPlaceholder")}
            disabled={anyStreaming}
            className="h-9 flex-1 rounded-xl border border-border bg-surface-2 px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={submitFollowUp}
            disabled={anyStreaming || !followUpDraft.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-[12px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-40"
          >
            <Icon name="sparkles" size={12} />
            {t("followUpSubmit")}
          </button>
        </div>
        <div className="mt-1.5 font-mono text-[10px] text-text-subtle">
          {t("followUpHint")}
        </div>
      </div>
    </div>
  );
}

// One turn's answer body. Splits on `[N]` markers; while ``streaming``,
// Copy-as-citation — turns a finished Q&A turn into a self-contained
// markdown blob (question / answer with [N] inline / numbered footnotes)
// suitable for pasting into a doc or chat. Mirrors NotebookLM's "Copy"
// + Perplexity's share-as-text. We bias toward markdown because the
// allhands chat surface renders it natively and so do most editors.
function CopyAsCitationButton({ turn }: { turn: AskTurnView }) {
  const t = useTranslations("knowledge.ask");
  const [copied, setCopied] = useState(false);

  async function copy() {
    const md = renderTurnAsMarkdown(turn);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Some browsers block clipboard write outside user gestures or
      // require https. Fall back to a brief alert; the user can re-try.
      alert(t("copyFailed"));
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[10px] text-text-subtle opacity-0 transition group-hover:opacity-100 hover:text-text"
      title={t("copyAsCitationTitle")}
    >
      <Icon name={copied ? "check" : "copy"} size={10} />
      {copied ? t("copied") : t("copyAsCitation")}
    </button>
  );
}

function renderTurnAsMarkdown(turn: AskTurnView): string {
  const lines: string[] = [];
  lines.push(`> **Q:** ${turn.question}`);
  lines.push("");
  lines.push(turn.answer.trim());
  if (turn.sources.length > 0) {
    lines.push("");
    lines.push("**Sources**");
    for (const s of turn.sources) {
      const sec = s.section_path ? ` · § ${s.section_path}` : "";
      lines.push(`- [${s.n}] ${s.citation}${sec}`);
    }
  }
  if (turn.usedModel) {
    lines.push("");
    lines.push(`*Generated with ${turn.usedModel}*`);
  }
  return lines.join("\n");
}

// shows a blinking caret so the user sees progress before sources lock in.
function AskTurnAnswer({
  turn,
  onChunkClick,
}: {
  turn: AskTurnView;
  onChunkClick: (docId: string) => void;
}) {
  const t = useTranslations("knowledge.ask");
  if (turn.error) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">
        {turn.error}
      </div>
    );
  }
  if (turn.streaming && !turn.answer) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-[13px] text-text-muted">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
        <span>{t("thinkingTitle")}</span>
      </div>
    );
  }
  const parts = renderAnswerWithCites(
    turn.answer,
    turn.sources,
    onChunkClick,
    turn.id,
  );
  return (
    <div className="group relative rounded-xl border border-border bg-surface-2 p-4">
      <p className="whitespace-pre-wrap text-[14px] leading-[1.7] text-text">
        {parts}
        {turn.streaming && (
          <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-primary align-middle" />
        )}
      </p>
      {!turn.streaming && turn.answer && (
        <CopyAsCitationButton turn={turn} />
      )}
    </div>
  );
}

function AskTurnSources({
  turn,
  onChunkClick,
}: {
  turn: AskTurnView;
  onChunkClick: (docId: string) => void;
}) {
  const t = useTranslations("knowledge.ask");
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className={SECTION_LABEL}>{t("sourcesLabel")}</span>
        <span className="font-mono text-[10px] text-text-subtle">
          {t("sourcesCount", { count: turn.sources.length })}
        </span>
      </div>
      <ul className="space-y-2">
        {turn.sources.map((s) => (
          <li
            key={s.chunk_id}
            id={`src-${turn.id}-${s.n}`}
            className="rounded-xl border border-border bg-surface p-3"
          >
            <button
              type="button"
              onClick={() => onChunkClick(s.doc_id)}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-primary-muted px-2 py-0.5 font-mono text-[10px] text-primary">
                  [{s.n}]
                </span>
                <span className="font-mono text-[11px] text-text-muted">
                  {s.citation}
                </span>
              </div>
              <span className="font-mono text-[10px] text-text-subtle">
                {s.score.toFixed(4)}
              </span>
            </button>
            {s.section_path && (
              <div className="mt-1.5 font-mono text-[10px] text-text-subtle">
                {s.section_path}
              </div>
            )}
            <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[12px] leading-relaxed text-text">
              {s.text}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderAnswerWithCites(
  answer: string,
  sources: AskSource[],
  onClickSource: (docId: string) => void,
  turnId?: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\[(\d+)\]/g;
  const known = new Map(sources.map((s) => [s.n, s] as const));
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(answer)) !== null) {
    if (m.index > last) {
      out.push(<span key={`t${key++}`}>{answer.slice(last, m.index)}</span>);
    }
    const n = Number(m[1]);
    const src = known.get(n);
    if (src) {
      out.push(
        <button
          key={`c${key++}`}
          type="button"
          onClick={() => {
            const id = turnId ? `src-${turnId}-${n}` : `src-${n}`;
            const el = document.getElementById(id);
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
            onClickSource(src.doc_id);
          }}
          className="mx-0.5 inline-flex items-center rounded-md bg-primary-muted px-1.5 align-baseline font-mono text-[11px] text-primary hover:bg-primary/20 transition duration-fast"
          title={src.citation}
        >
          [{n}]
        </button>,
      );
    } else {
      out.push(<span key={`t${key++}`}>{m[0]}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < answer.length) {
    out.push(<span key={`t${key++}`}>{answer.slice(last)}</span>);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Search results view
// ─────────────────────────────────────────────────────────────────────────────

function SearchResultsView({
  query,
  results,
  searching,
  onChunkClick,
}: {
  query: string;
  results: ScoredChunkDto[] | null;
  searching: boolean;
  onChunkClick: (docId: string) => void;
}) {
  const t = useTranslations("knowledge.search");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Icon name="search" size={13} className="text-text-subtle" />
          <div className={SECTION_LABEL}>{t("sectionLabel")}</div>
          <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text">
            &ldquo;{query}&rdquo;
          </span>
        </div>
        {results && (
          <span className="font-mono text-[10px] text-text-subtle">
            {t("hits", { count: results.length })}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {searching && (
          <div className="flex h-full items-center justify-center">
            <LoadingState title={t("loadingTitle")} description={t("loadingDesc")} />
          </div>
        )}
        {!searching && results && results.length === 0 && (
          <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
            {t("noResults")}
          </div>
        )}
        {!searching &&
          results?.map((r, i) => (
            <SearchResultCard
              key={r.chunk_id}
              rank={i + 1}
              query={query}
              result={r}
              onClick={() => onChunkClick(r.document_id)}
            />
          ))}
      </div>
    </div>
  );
}

// One search-result card with an inline "Why?" expander explaining how
// this chunk got its rank: BM25 vs vector contribution + which query
// tokens matched the chunk text. Mirrors Perplexity's "show steps" and
// Glean's relevance breakdown — surfacing the retrieval math turns hybrid
// search from a black box into a debuggable pipeline.
function SearchResultCard({
  rank,
  query,
  result,
  onClick,
}: {
  rank: number;
  query: string;
  result: ScoredChunkDto;
  onClick: () => void;
}) {
  const t = useTranslations("knowledge.search");
  const [open, setOpen] = useState(false);

  const { tokens, matched } = useMemo(
    () => analyseQueryMatch(query, result.text),
    [query, result.text],
  );
  const hasBoth = result.bm25_rank != null && result.vector_rank != null;

  return (
    <div className="rounded-xl border border-border bg-surface-2 p-4 transition duration-fast hover:border-border-strong hover:shadow-soft-sm">
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-primary-muted px-2 py-0.5 font-mono text-[10px] text-primary">
              #{rank}
            </span>
            <span className="font-mono text-[11px] text-text-muted">
              {result.citation}
            </span>
            {result.bm25_rank != null && (
              <span className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
                BM25 #{result.bm25_rank}
              </span>
            )}
            {result.vector_rank != null && (
              <span className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
                vec #{result.vector_rank}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end font-mono text-[10px] text-text-subtle">
            <span>{t("scoreLabel")}</span>
            <span className="text-[12px] text-text">
              {result.score.toFixed(4)}
            </span>
          </div>
        </div>
        {result.section_path && (
          <div className="mt-2 font-mono text-[10px] text-text-subtle">
            {result.section_path}
          </div>
        )}
        <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[13px] leading-relaxed text-text">
          {highlightTokens(result.text, matched)}
        </p>
      </button>

      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-text-subtle hover:text-text"
          aria-expanded={open}
        >
          <Icon
            name={open ? "chevron-up" : "chevron-down"}
            size={11}
          />
          {t("explainLabel")}
        </button>
        {tokens.length > 0 && (
          <span className="font-mono text-[10px] text-text-subtle">
            {t("matchedTokens", { matched: matched.length, total: tokens.length })}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3 rounded-lg border border-border bg-surface px-3 py-3 text-[12px]">
          {/* BM25 vs Vector contribution bar — visualises which lens
              this chunk leaned on. Equal-weight retrieval averages the
              two ranks, so the bar is a heuristic readout, not the exact
              fused score formula. Still useful to spot "lexical-heavy"
              vs "semantic-heavy" hits at a glance. */}
          <ContributionBar
            bm25Rank={result.bm25_rank}
            vectorRank={result.vector_rank}
          />
          {tokens.length > 0 && (
            <div>
              <div className={SECTION_LABEL}>{t("matchedHeader")}</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {tokens.map((tok) => {
                  const hit = matched.includes(tok);
                  return (
                    <span
                      key={tok}
                      className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                        hit
                          ? "bg-success-soft text-success border border-success/30"
                          : "border border-border bg-surface-2 text-text-subtle"
                      }`}
                    >
                      {tok}
                      {hit ? " ✓" : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          <div className="font-mono text-[10px] leading-relaxed text-text-subtle">
            {hasBoth
              ? t("explainBoth", {
                  bm25: result.bm25_rank ?? 0,
                  vec: result.vector_rank ?? 0,
                })
              : result.bm25_rank != null
                ? t("explainBm25Only", { bm25: result.bm25_rank })
                : t("explainVecOnly", { vec: result.vector_rank ?? 0 })}
          </div>
        </div>
      )}
    </div>
  );
}

function ContributionBar({
  bm25Rank,
  vectorRank,
}: {
  bm25Rank: number | null;
  vectorRank: number | null;
}) {
  const t = useTranslations("knowledge.search");
  // Lower rank = better. We invert into pseudo-strength in [0, 1] using
  // 1/rank, then normalise the pair to sum to 1 so the bar reads as a
  // share of contribution.
  const bm = bm25Rank != null ? 1 / bm25Rank : 0;
  const vc = vectorRank != null ? 1 / vectorRank : 0;
  const total = bm + vc || 1;
  const bmPct = Math.round((bm / total) * 100);
  const vcPct = 100 - bmPct;
  return (
    <div>
      <div className={SECTION_LABEL}>{t("contributionHeader")}</div>
      <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
        {bm > 0 && (
          <div
            className="h-full bg-primary"
            style={{ width: `${bmPct}%` }}
            title={t("bm25Pct", { pct: bmPct })}
          />
        )}
        {vc > 0 && (
          <div
            className="h-full bg-accent"
            style={{ width: `${vcPct}%` }}
            title={t("vectorPct", { pct: vcPct })}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-text-subtle">
        <span>
          BM25 {bmPct}%
        </span>
        <span>
          {t("vectorPctLabel")} {vcPct}%
        </span>
      </div>
    </div>
  );
}

// Cheap query → token analysis. Splits on non-CJK / non-word boundaries,
// drops stop-shorts (1-char ASCII), case-folds, then checks each token
// against the chunk text. The "matched" set drives both the chip row
// and the in-text highlights. This is a heuristic — the real BM25
// scorer uses tokeniser + IDF — but it lets users *see* what their query
// matched without a round-trip.
function analyseQueryMatch(
  query: string,
  text: string,
): { tokens: string[]; matched: string[] } {
  const raw = query
    .toLowerCase()
    .split(/[\s,.;:!?'"()\[\]{}<>=*&|/\\]+/)
    .filter((w) => w.length > 1 || /[\u4e00-\u9fff]/.test(w));
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const w of raw) {
    if (!seen.has(w)) {
      seen.add(w);
      tokens.push(w);
    }
  }
  const lower = text.toLowerCase();
  const matched = tokens.filter((tok) => lower.includes(tok));
  return { tokens, matched };
}

function highlightTokens(text: string, matched: string[]): React.ReactNode {
  if (matched.length === 0) return text;
  // Build a single regex of all matched tokens, escaped for safety.
  const re = new RegExp(
    `(${matched
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})`,
    "gi",
  );
  const parts = text.split(re);
  return parts.map((part, i) =>
    matched.some((m) => m.toLowerCase() === part.toLowerCase()) ? (
      <mark
        key={i}
        className="rounded-sm bg-warning-soft px-0.5 text-text"
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modals + drawer
// ─────────────────────────────────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = useTranslations("knowledge.modal");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-semibold text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-subtle hover:text-text"
            aria-label={t("closeAria")}
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Bulk tag editor — reused for "tag N selected docs" workflow.
// Two columns: existing tags (toggle to add/remove) and a freeform input
// (comma-separated new tags to apply). The "+ / −" pair next to each
// known tag tells us per-tag whether the user wants to add it, remove
// it, or leave it alone — three-state per chip rather than a single
// click. Apply diffs both sets to the patchDocumentTags shape.
function BulkTagModal({
  knownTags,
  selectionCount,
  onClose,
  onApply,
}: {
  knownTags: string[];
  selectionCount: number;
  onClose: () => void;
  onApply: (add: string[], remove: string[]) => void | Promise<void>;
}) {
  const t = useTranslations("knowledge.bulkTags");
  const [intents, setIntents] = useState<Record<string, "add" | "remove" | null>>(
    {},
  );
  const [newTagsRaw, setNewTagsRaw] = useState("");

  const cycleTag = (tag: string) => {
    setIntents((prev) => {
      const next = { ...prev };
      const cur = next[tag] ?? null;
      next[tag] = cur === null ? "add" : cur === "add" ? "remove" : null;
      return next;
    });
  };

  const addList = [
    ...Object.entries(intents)
      .filter(([, v]) => v === "add")
      .map(([k]) => k),
    ...newTagsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  const removeList = Object.entries(intents)
    .filter(([, v]) => v === "remove")
    .map(([k]) => k);

  return (
    <ModalShell
      title={t("title", { count: selectionCount })}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:text-text"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void onApply(addList, removeList)}
            disabled={addList.length === 0 && removeList.length === 0}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-40"
          >
            <Icon name="check" size={11} />
            {t("apply", {
              add: addList.length,
              remove: removeList.length,
            })}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-[12px]">
        <p className="text-text-muted leading-relaxed">{t("intro")}</p>

        {knownTags.length > 0 && (
          <div>
            <div className={SECTION_LABEL}>{t("knownHeader")}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {knownTags.map((tag) => {
                const intent = intents[tag] ?? null;
                const cls =
                  intent === "add"
                    ? "border-success/40 bg-success-soft text-success"
                    : intent === "remove"
                      ? "border-danger/40 bg-danger-soft text-danger"
                      : "border-border bg-surface-2 text-text-muted hover:text-text";
                const sym = intent === "add" ? "+" : intent === "remove" ? "−" : "·";
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => cycleTag(tag)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] transition duration-fast ${cls}`}
                    title={t("cycleHint")}
                  >
                    <span className="font-bold">{sym}</span>
                    {tag}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 font-mono text-[10px] text-text-subtle">
              {t("legend")}
            </div>
          </div>
        )}

        <div>
          <div className={SECTION_LABEL}>{t("newHeader")}</div>
          <input
            type="text"
            value={newTagsRaw}
            onChange={(e) => setNewTagsRaw(e.target.value)}
            placeholder={t("newPlaceholder")}
            className="mt-1.5 h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-[12px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
        </div>
      </div>
    </ModalShell>
  );
}

function UrlIngestModal({
  kb,
  onClose,
  onIngested,
  onError,
}: {
  kb: KBDto;
  onClose: () => void;
  onIngested: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("knowledge.urlIngest");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!url.trim()) return;
    setSubmitting(true);
    try {
      await ingestUrl(kb.id, url.trim(), {
        title: title.trim() || undefined,
        tags: tagsRaw
          ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
          : undefined,
      });
      onIngested();
    } catch (e) {
      onError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title={t("title", { kb: kb.name })}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!url.trim() || submitting}
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40 transition duration-fast"
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("fieldUrl")}>
          <input
            type="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("urlPlaceholder")}
            className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
          <p className="mt-1 font-mono text-[10px] text-text-subtle">
            {t("urlHint")}
          </p>
        </Field>
        <Field label={t("fieldTitle")}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("titlePlaceholder")}
            className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
        </Field>
        <Field label={t("fieldTags")}>
          <input
            type="text"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder={t("tagsPlaceholder")}
            className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
        </Field>
      </div>
    </ModalShell>
  );
}

function CreateKBModal({
  models,
  onClose,
  onCreated,
  onError,
}: {
  models: EmbeddingModelOption[];
  onClose: () => void;
  onCreated: (kb: KBDto) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("knowledge.create");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelRef, setModelRef] = useState(
    models.find((m) => m.is_default && m.available)?.ref ??
      models.find((m) => m.available)?.ref ??
      "",
  );
  const [submitting, setSubmitting] = useState(false);

  const modelOptions = models.map((m) => ({
    value: m.ref,
    label: m.label,
    hint: t("embeddingHintDim", { dim: m.dim }),
    disabled: !m.available,
  }));

  async function submit() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const kb = await createKB({
        name: name.trim(),
        description: description.trim(),
        embedding_model_ref: modelRef || undefined,
      });
      onCreated(kb);
    } catch (e) {
      onError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title={t("title")}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || submitting}
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40 transition duration-fast"
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("fieldName")}>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
        </Field>
        <Field label={t("fieldDescription")}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder={t("descriptionPlaceholder")}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none resize-none"
          />
        </Field>
        <Field label={t("fieldEmbedding")}>
          <Select
            value={modelRef}
            onChange={setModelRef}
            options={modelOptions}
            placeholder={t("embeddingPlaceholder")}
            className="w-full"
            triggerClassName="h-9 rounded-xl"
            ariaLabel={t("embeddingAria")}
          />
          <p className="mt-1 font-mono text-[10px] text-text-subtle">
            {t("embeddingHelp")}
          </p>
        </Field>
      </div>
    </ModalShell>
  );
}

/**
 * KBSettingsModal — KB settings (Basic / Advanced / Danger tabs).
 *
 * Goal: gather every KB-related adjustment in one place rather than
 * scattering them across the sidebar or KB card. Basic tab explains the
 * current "intelligence level" in plain language; Advanced tab exposes
 * BM25 / vector / top_k tuning knobs; Danger tab isolates deletion.
 */
function KBSettingsModal({
  kb,
  models,
  onClose,
  onSaved,
  onDelete,
  onError,
}: {
  kb: KBDto;
  models: EmbeddingModelOption[];
  onClose: () => void;
  onSaved: (next: KBDto) => void;
  onDelete: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("knowledge.settings");
  const ta = useTranslations("knowledge.advanced");
  type Tab = "basic" | "advanced" | "diagnose" | "danger";
  const [tab, setTab] = useState<Tab>("basic");

  // Advanced state
  const [bm25, setBm25] = useState(kb.retrieval_config.bm25_weight);
  const [vec, setVec] = useState(kb.retrieval_config.vector_weight);
  const [topK, setTopK] = useState(kb.retrieval_config.top_k);
  const [reranker, setReranker] = useState(kb.retrieval_config.reranker);
  const [saving, setSaving] = useState(false);

  const rerankerOptions = [
    { value: "none", label: ta("rerankerNone") },
    { value: "bge-base", label: ta("rerankerBge"), disabled: true, hint: ta("rerankerHintM3") },
    { value: "cohere", label: ta("rerankerCohere"), disabled: true, hint: ta("rerankerHintM3") },
  ];

  async function saveAdvanced() {
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

  const tabs: {
    id: Tab;
    label: string;
    icon: "info" | "settings" | "search" | "trash-2";
  }[] = [
    { id: "basic", label: t("tabs.basic"), icon: "info" },
    { id: "diagnose", label: t("tabs.diagnose"), icon: "search" },
    { id: "advanced", label: t("tabs.advanced"), icon: "settings" },
    { id: "danger", label: t("tabs.danger"), icon: "trash-2" },
  ];

  return (
    <ModalShell
      title={t("titleSuffix", { name: kb.name })}
      onClose={onClose}
      footer={
        tab === "advanced" ? (
          <>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={saveAdvanced}
              disabled={saving}
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40 transition duration-fast"
            >
              {saving ? t("saving") : t("save")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
          >
            {t("close")}
          </button>
        )
      }
    >
      {/* Tabs */}
      <div className="-mt-2 mb-4 flex gap-1 border-b border-border">
        {tabs.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-[13px] transition duration-fast ${
                active
                  ? "border-primary text-text"
                  : "border-transparent text-text-muted hover:text-text"
              }`}
            >
              <Icon name={t.icon} size={13} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Basic tab — embedder picker + plain-language explanation */}
      {tab === "basic" && (
        <BasicTab kb={kb} models={models} onSwitched={onSaved} />
      )}

      {/* Advanced tab — retrieval tune */}
      {tab === "advanced" && (
        <div className="space-y-4">
          <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-text-muted">
            {ta.rich("intro", {
              br: () => <br />,
              mono: (chunks) => <span className="font-mono text-[11px]">{chunks}</span>,
            })}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label={ta("fieldBm25")}>
              <input
                type="number"
                min={0}
                step={0.1}
                value={bm25}
                onChange={(e) => setBm25(Number(e.target.value))}
                className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text focus:border-border-strong focus:outline-none"
              />
            </Field>
            <Field label={ta("fieldVec")}>
              <input
                type="number"
                min={0}
                step={0.1}
                value={vec}
                onChange={(e) => setVec(Number(e.target.value))}
                className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text focus:border-border-strong focus:outline-none"
              />
            </Field>
            <Field label={ta("fieldTopK")}>
              <input
                type="number"
                min={1}
                max={100}
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text focus:border-border-strong focus:outline-none"
              />
            </Field>
            <Field label={ta("fieldReranker")}>
              <Select
                value={reranker}
                onChange={(v) => setReranker(v as "none" | "bge-base" | "cohere")}
                options={rerankerOptions}
                className="w-full"
                triggerClassName="h-9 rounded-xl"
                ariaLabel={ta("rerankerAria")}
              />
            </Field>
          </div>
        </div>
      )}

      {/* Diagnose tab — side-by-side BM25/vec/Hybrid */}
      {tab === "diagnose" && <DiagnoseTab kb={kb} />}

      {/* Danger tab — delete */}
      {tab === "danger" && <DangerTab kb={kb} onDelete={onDelete} />}
    </ModalShell>
  );
}

/**
 * Diagnose tab — same query, three lenses, side-by-side. Helps users
 * see what BM25 alone returns vs. vector alone vs. hybrid, so the
 * "why didn't this hit" / "why is this ranked first" question becomes
 * visible instead of magic.
 */
function DiagnoseTab({ kb }: { kb: KBDto }) {
  const t = useTranslations("knowledge.diagnose");
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [out, setOut] = useState<DiagnoseDto | null>(null);
  const [stats, setStats] = useState<KBStatsDto | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void getKBStats(kb.id).then(setStats).catch(() => {});
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
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder={t("queryPlaceholder")}
          className="h-9 flex-1 rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
        />
        <button
          type="button"
          onClick={run}
          disabled={running || !query.trim()}
          className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-[12px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-40 transition duration-fast"
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
        <div className="grid grid-cols-3 gap-3">
          <DiagnoseColumn
            title={t("colKeywordTitle")}
            subtitle={t("colKeywordSubtitle")}
            tone="warning"
            results={out.bm25_only}
          />
          <DiagnoseColumn
            title={t("colVectorTitle")}
            subtitle={t("colVectorSubtitle")}
            tone="primary"
            results={out.vector_only}
          />
          <DiagnoseColumn
            title={t("colHybridTitle")}
            subtitle={t("colHybridSubtitle")}
            tone="success"
            results={out.hybrid}
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
              {t("statsSummary", { count: stats.count, avg: stats.avg_latency_ms?.toFixed(0) ?? "0" })}
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

function DiagnoseColumn({
  title,
  subtitle,
  tone,
  results,
}: {
  title: string;
  subtitle: string;
  tone: "warning" | "primary" | "success";
  results: ScoredChunkDto[];
}) {
  const t = useTranslations("knowledge.diagnose");
  const toneCls =
    tone === "warning"
      ? "border-warning/40 bg-warning-soft"
      : tone === "success"
        ? "border-success/30 bg-success-soft"
        : "border-primary/30 bg-primary-muted";
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-border bg-surface">
      <div className={`rounded-t-xl border-b border-border px-3 py-2 ${toneCls}`}>
        <div className="text-[12px] font-semibold text-text">{title}</div>
        <div className="font-mono text-[10px] text-text-subtle">{subtitle}</div>
      </div>
      <ul className="space-y-1.5 p-2">
        {results.length === 0 && (
          <li className="px-2 py-3 text-center text-[11px] text-text-subtle">
            {t("noHits")}
          </li>
        )}
        {results.map((r, i) => (
          <li key={r.chunk_id} className="rounded-lg border border-border bg-surface-2 p-2">
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

function BasicTab({
  kb,
  models,
  onSwitched,
}: {
  kb: KBDto;
  models: EmbeddingModelOption[];
  onSwitched: (next: KBDto) => void;
}) {
  const t = useTranslations("knowledge.basic");
  const isMock = kb.embedding_model_ref.startsWith("mock:");
  const realAvailable = models.filter(
    (m) => !m.ref.startsWith("mock:") && m.available,
  );
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  async function pickModel(ref: string) {
    if (ref === kb.embedding_model_ref) return;
    if (switchingTo) return;
    if (
      !confirm(
        t("switchConfirm", {
          model: ref,
          docs: kb.document_count,
        }),
      )
    )
      return;
    setSwitchingTo(ref);
    try {
      const out = await switchEmbeddingModel(kb.id, ref);
      onSwitched(out.kb);
      alert(
        t("switchSummary", {
          processed: out.reembed.processed,
          succeeded: out.reembed.succeeded,
          failed: out.reembed.failed,
        }),
      );
    } catch (e) {
      alert(`${t("switchFailed")}\n${e}`);
    } finally {
      setSwitchingTo(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Current state — friendly */}
      <div
        className={`rounded-xl border p-4 ${
          isMock
            ? "border-warning/40 bg-warning-soft"
            : "border-success/30 bg-success-soft"
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

      {/* Provider sourcing — pulls from /gateway, no .env */}
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
                  <a href="/gateway" className="text-primary underline">{chunks}</a>
                ),
              })}
            </p>
            <a
              href="/gateway"
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg hover:bg-primary-hover transition duration-fast"
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
                const switching = switchingTo === m.ref;
                return (
                  <li key={m.ref}>
                    <button
                      type="button"
                      onClick={() => void pickModel(m.ref)}
                      disabled={active || switchingTo !== null}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-[12px] transition duration-fast ${
                        active
                          ? "border-success/40 bg-success-soft text-text cursor-default"
                          : switching
                            ? "border-primary bg-primary-muted text-text cursor-wait"
                            : "border-border bg-surface-2 text-text hover:border-primary/40 hover:bg-primary-muted/30"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {active && (
                          <Icon
                            name="check"
                            size={12}
                            className="text-success"
                          />
                        )}
                        {switching && (
                          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                        )}
                        <span>{m.label}</span>
                      </span>
                      <span className="font-mono text-[10px] text-text-subtle">
                        {switching
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

function DangerTab({
  kb,
  onDelete,
}: {
  kb: KBDto;
  onDelete: () => void;
}) {
  const t = useTranslations("knowledge.danger");
  const [confirm, setConfirm] = useState("");
  const enabled = confirm === kb.name;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-danger/30 bg-danger-soft p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-danger">
          <Icon name="alert-triangle" size={14} />
          {t("heading")}
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-danger/90">
          {t.rich("warning", {
            prefix: kb.id.slice(0, 8),
            code: (chunks) => (
              <code className="font-mono text-[11px]">{chunks}</code>
            ),
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
        onClick={onDelete}
        disabled={!enabled}
        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-danger px-3 text-[13px] font-medium text-white shadow-soft-sm hover:bg-danger/90 disabled:opacity-30 disabled:cursor-not-allowed transition duration-fast"
      >
        <Icon name="trash-2" size={13} />
        {t("deleteAction")}
      </button>
    </div>
  );
}

function DocDrawer({
  doc,
  kbId,
  onClose,
  onDelete,
  onTagsChanged,
}: {
  doc: DocumentDto;
  kbId: string;
  onClose: () => void;
  onDelete: (d: DocumentDto) => void;
  onTagsChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("knowledge.detail");
  const locale = useLocale();
  type Tab = "info" | "text" | "chunks";
  const [tab, setTab] = useState<Tab>("info");
  const [text, setText] = useState<string | null>(null);
  const [chunks, setChunks] = useState<DocumentChunkDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [textErr, setTextErr] = useState<string | null>(null);

  // Lazy-load tab content. Avoids fetching megabytes of text when the
  // user just wanted to see metadata.
  useEffect(() => {
    if (tab === "text" && text === null && !loading) {
      setLoading(true);
      getDocumentText(kbId, doc.id)
        .then(setText)
        .catch((e) => setTextErr(String(e)))
        .finally(() => setLoading(false));
    }
    if (tab === "chunks" && chunks === null && !loading) {
      setLoading(true);
      listDocumentChunks(kbId, doc.id)
        .then(setChunks)
        .catch((e) => setTextErr(String(e)))
        .finally(() => setLoading(false));
    }
  }, [tab, kbId, doc.id, text, chunks, loading]);

  const tabs: { id: Tab; label: string; icon: "info" | "file" | "list" }[] = [
    { id: "info", label: t("tabInfo"), icon: "info" },
    { id: "text", label: t("tabText"), icon: "file" },
    {
      id: "chunks",
      label: t("tabChunks", { count: doc.chunk_count }),
      icon: "list",
    },
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-bg/40 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-border bg-surface shadow-soft-lg">
        <header className="flex items-start justify-between gap-2 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <MimeBadge mime={doc.mime_type} />
              <StatePill state={doc.state} />
            </div>
            <h2 className="break-words text-[15px] font-semibold text-text">
              {doc.title}
            </h2>
            <div className="mt-1 font-mono text-[10px] text-text-subtle">
              {t("headerMeta", {
                version: doc.version,
                kb: (doc.size_bytes / 1024).toFixed(1),
                chunks: doc.chunk_count,
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-subtle hover:text-text"
            aria-label={t("closeAria")}
          >
            ✕
          </button>
        </header>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border px-5">
          {tabs.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-[12px] transition duration-fast ${
                  active
                    ? "border-primary text-text"
                    : "border-transparent text-text-muted hover:text-text"
                }`}
              >
                <Icon name={t.icon} size={12} />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "info" && (
            <div className="space-y-4 p-5 text-[12px] leading-relaxed">
              {doc.state_error && (
                <div className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-danger">
                  {doc.state_error}
                </div>
              )}
              <DocMetaSection title={t("infoSectionBasic")}>
                <MetaRow label={t("metaId")} value={doc.id} mono />
                <MetaRow label={t("metaMime")} value={doc.mime_type} mono />
                <MetaRow label={t("metaSource")} value={doc.source_type} mono />
                {doc.source_uri && (
                  <MetaRow label={t("metaUri")} value={doc.source_uri} mono />
                )}
                <MetaRow
                  label={t("metaCreated")}
                  value={new Date(doc.created_at).toLocaleString(locale)}
                />
                <MetaRow
                  label={t("metaUpdated")}
                  value={new Date(doc.updated_at).toLocaleString(locale)}
                />
              </DocMetaSection>
              <DocMetaSection title={t("infoSectionTags")}>
                <DocTagsEditor doc={doc} kbId={kbId} onChanged={onTagsChanged} />
              </DocMetaSection>
            </div>
          )}

          {tab === "text" && (
            <div className="p-5" id="doc-text-pane">
              {loading && text === null ? (
                <LoadingState title={t("loadingText")} />
              ) : textErr ? (
                <ErrorState title={textErr} />
              ) : text === null || text.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12px] text-text-muted">
                  {t("emptyText")}
                </div>
              ) : isMarkdownLikely(doc.mime_type) ? (
                <AgentMarkdown
                  content={text}
                  className="rounded-xl border border-border bg-surface-2 px-5 py-4 text-[13px] leading-relaxed"
                />
              ) : (
                <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-surface-2 p-4 text-[12px] leading-relaxed text-text">
                  {text}
                </pre>
              )}
            </div>
          )}

          {tab === "chunks" && (
            <div className="p-5">
              {loading && chunks === null ? (
                <LoadingState
                  title={t("loadingChunks")}
                  description={t("loadingChunksDesc")}
                />
              ) : chunks === null || chunks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12px] text-text-muted">
                  {t("emptyChunks")}
                </div>
              ) : (
                <ul className="space-y-3">
                  {chunks.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-xl border border-border bg-surface-2 p-3"
                    >
                      <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-text-subtle">
                        <span className="rounded-md bg-primary-muted px-1.5 py-0.5 text-primary">
                          #{c.ordinal + 1}
                        </span>
                        {c.section_path && <span>{c.section_path}</span>}
                        {c.page != null && (
                          <span className="rounded-md border border-border bg-surface px-1.5 py-0.5">
                            p{c.page}
                          </span>
                        )}
                        <span className="ml-auto">
                          {t("chunkRange", { start: c.span_start, end: c.span_end, tokens: c.token_count })}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            // Switch to text tab + scroll to span. AgentMarkdown
                            // renders async, so wait one frame then locate by
                            // searching the rendered text for a unique-enough
                            // prefix of the chunk.
                            setTab("text");
                            await new Promise((r) => setTimeout(r, 80));
                            const root = document.getElementById("doc-text-pane");
                            if (!root) return;
                            const needle = c.text.slice(0, 40);
                            const walker = document.createTreeWalker(
                              root,
                              NodeFilter.SHOW_TEXT,
                            );
                            let n: Node | null = walker.nextNode();
                            while (n) {
                              if ((n.textContent ?? "").includes(needle)) {
                                (n.parentElement as HTMLElement)?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "center",
                                });
                                (n.parentElement as HTMLElement)?.classList.add(
                                  "kb-highlight",
                                );
                                setTimeout(
                                  () =>
                                    (n!.parentElement as HTMLElement)?.classList.remove(
                                      "kb-highlight",
                                    ),
                                  1800,
                                );
                                return;
                              }
                              n = walker.nextNode();
                            }
                          }}
                          className="inline-flex h-5 items-center gap-1 rounded border border-border bg-surface px-1.5 text-[10px] text-text-muted hover:text-text hover:border-border-strong transition duration-fast"
                          title={t("jumpToSourceTitle")}
                        >
                          <Icon name="external-link" size={10} />
                          {t("jumpToSource")}
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-text">
                        {c.text}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3">
          <button
            type="button"
            onClick={() => onDelete(doc)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-3 text-[12px] text-danger hover:bg-danger/10 transition duration-fast"
          >
            <Icon name="trash-2" size={12} />
            {t("softDelete")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
          >
            {t("close")}
          </button>
        </footer>
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny helpers
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}

// Tag editor for a single doc, lives inside DocDrawer's Info tab.
// Shows current tags · provides an AI suggest button (sparkles icon)
// suggestTagsForDocument · pending suggestions appear as ghost chips
// the user clicks to accept(adds via PATCH). Existing tags can be
// removed by clicking ✕. The "+ tag" inline input adds custom tags.
function DocTagsEditor({
  doc,
  kbId,
  onChanged,
}: {
  doc: DocumentDto;
  kbId: string;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("knowledge.docTags");
  const [pending, setPending] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");

  const suggestionsToShow = (pending ?? []).filter((p) => !doc.tags.includes(p));

  async function runSuggest() {
    setBusy(true);
    try {
      const tags = await suggestTagsForDocument(kbId, doc.id);
      setPending(tags);
    } finally {
      setBusy(false);
    }
  }

  async function applyTag(tag: string) {
    await patchDocumentTags(kbId, doc.id, { add: [tag] });
    setPending((prev) => prev?.filter((p) => p !== tag) ?? null);
    await onChanged();
  }

  async function applyAll() {
    if (suggestionsToShow.length === 0) return;
    await patchDocumentTags(kbId, doc.id, { add: suggestionsToShow });
    setPending(null);
    await onChanged();
  }

  async function removeTag(tag: string) {
    await patchDocumentTags(kbId, doc.id, { remove: [tag] });
    await onChanged();
  }

  async function submitAdding() {
    const tag = adding.trim();
    if (!tag) return;
    setAdding("");
    if (doc.tags.includes(tag)) return;
    await patchDocumentTags(kbId, doc.id, { add: [tag] });
    await onChanged();
  }

  return (
    <div className="space-y-2.5">
      {/* Existing tags */}
      <div className="flex flex-wrap items-center gap-1.5">
        {doc.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 pl-2 pr-1 py-0.5 font-mono text-[10px] text-text-muted"
          >
            #{tag}
            <button
              type="button"
              onClick={() => void removeTag(tag)}
              className="text-text-subtle hover:text-danger"
              aria-label={t("removeAria", { tag })}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          type="text"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submitAdding();
            }
          }}
          placeholder={t("addPlaceholder")}
          className="h-6 w-32 rounded-full border border-border bg-surface px-2 font-mono text-[10px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
        />
      </div>

      {/* AI suggestion row */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runSuggest()}
          disabled={busy}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-2 font-mono text-[10px] text-text-muted hover:border-primary/40 hover:text-primary disabled:opacity-40"
        >
          <Icon name="sparkles" size={10} />
          {busy ? t("suggesting") : t("suggestCta")}
        </button>
        {suggestionsToShow.length > 0 && (
          <>
            {suggestionsToShow.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => void applyTag(tag)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 bg-primary-muted px-2 py-0.5 font-mono text-[10px] text-primary hover:border-primary"
                title={t("acceptOneHint")}
              >
                + #{tag}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void applyAll()}
              className="inline-flex h-6 items-center gap-1 rounded-md bg-primary px-2 font-mono text-[10px] text-primary-fg hover:bg-primary-hover"
            >
              <Icon name="check" size={10} />
              {t("acceptAll", { count: suggestionsToShow.length })}
            </button>
          </>
        )}
      </div>
      {pending !== null && pending.length === 0 && suggestionsToShow.length === 0 && (
        <p className="font-mono text-[10px] text-text-subtle">
          {t("noSuggestions")}
        </p>
      )}
    </div>
  );
}

function DocMetaSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-text-subtle">{label}</dt>
      <dd
        className={`min-w-0 flex-1 truncate text-right text-text ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
