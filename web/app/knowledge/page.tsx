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

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Icon } from "@/components/ui/icon";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
import {
  type DocumentDto,
  type EmbeddingModelOption,
  type KBDto,
  type ScoredChunkDto,
  createKB,
  deleteDocument,
  listDocuments,
  listEmbeddingModels,
  listKBs,
  searchKB,
  updateRetrievalConfig,
  uploadDocument,
} from "@/lib/kb-api";

const STATE_FILTERS = [
  { value: "", label: "全部状态" },
  { value: "ready", label: "Ready" },
  { value: "indexing", label: "Indexing" },
  { value: "failed", label: "Failed" },
];

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
  const [kbs, setKbs] = useState<KBDto[] | null>(null);
  const [activeKb, setActiveKb] = useState<KBDto | null>(null);
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [models, setModels] = useState<EmbeddingModelOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ScoredChunkDto[] | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageState, setPageState] = useState<"loading" | "ok" | "error">(
    "loading",
  );
  const [showCreate, setShowCreate] = useState(false);
  const [showTune, setShowTune] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocumentDto | null>(null);

  async function refreshKbs(preserve?: KBDto | null) {
    try {
      const data = await listKBs();
      setKbs(data);
      const target = preserve ? data.find((k) => k.id === preserve.id) : null;
      if (target) setActiveKb(target);
      else if (!activeKb && data.length > 0) setActiveKb(data[0] ?? null);
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
  }

  useEffect(() => {
    void refreshKbs();
    listEmbeddingModels()
      .then(setModels)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (activeKb) {
      void refreshDocs(activeKb.id);
      // Reset query state on KB switch
      setSearchQuery("");
      setCommittedQuery("");
      setResults(null);
    }
  }, [activeKb?.id]);

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
    setCommittedQuery(searchQuery.trim());
    setResults(null);
    try {
      setResults(await searchKB(activeKb.id, searchQuery.trim()));
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  }

  async function handleClearSearch() {
    setSearchQuery("");
    setCommittedQuery("");
    setResults(null);
  }

  async function handleDeleteDoc(d: DocumentDto) {
    if (!activeKb) return;
    if (!confirm(`确认删除 "${d.title}"?(软删,30 天可恢复)`)) return;
    try {
      await deleteDocument(activeKb.id, d.id);
      setOpenDoc(null);
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
        hint: `${k.document_count} docs`,
      })),
    [kbs],
  );

  // Document filter (state)
  const filteredDocs = useMemo(() => {
    if (!docs) return [];
    if (!stateFilter) return docs;
    return docs.filter((d) => d.state === stateFilter);
  }, [docs, stateFilter]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="flex h-full flex-col gap-4 p-6">
        <PageHeader
          title="知识库"
          subtitle="工作区级文档库 · Hybrid 检索 (BM25 + 向量 + RRF) · Tool-First 写入"
          count={kbs?.length ?? 0}
        />

        {error && (
          <div className="flex items-center justify-between rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            <span className="truncate">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-3 text-text-subtle hover:text-text"
              aria-label="dismiss"
            >
              ✕
            </button>
          </div>
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
              placeholder="选择 KB"
              className="min-w-[200px]"
              triggerClassName="h-9 rounded-xl"
              ariaLabel="选择知识库"
            />
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
              aria-label="新建 KB"
            >
              <Icon name="plus" size={13} />
              <span>新建 KB</span>
            </button>

            {/* Search bar */}
            <div className="relative ml-auto flex min-w-[300px] flex-1 max-w-[640px]">
              <Icon
                name="search"
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSearch();
                  if (e.key === "Escape") void handleClearSearch();
                }}
                placeholder={
                  activeKb
                    ? `检索 ${activeKb.name}…  (BM25 + 向量 + RRF)`
                    : "选个 KB 再搜"
                }
                disabled={!activeKb}
                className="h-9 w-full rounded-xl border border-border bg-surface pl-9 pr-20 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none disabled:opacity-50"
              />
              {committedQuery && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-12 top-1/2 -translate-y-1/2 text-[11px] text-text-subtle hover:text-text"
                  aria-label="清除"
                >
                  ✕
                </button>
              )}
              <button
                type="button"
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim() || !activeKb}
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-7 items-center rounded-lg bg-primary px-3 text-[11px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40 transition duration-fast"
              >
                {searching ? "…" : "Search"}
              </button>
            </div>

            <Select
              value={stateFilter}
              onChange={setStateFilter}
              options={STATE_FILTERS}
              className="min-w-[120px]"
              triggerClassName="h-9 rounded-xl"
              ariaLabel="状态过滤"
            />

            <label
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium text-primary-fg shadow-soft-sm transition duration-fast cursor-pointer ${
                activeKb
                  ? "bg-primary hover:bg-primary-hover"
                  : "bg-primary opacity-40 cursor-not-allowed"
              }`}
            >
              <Icon name="upload" size={13} />
              {uploading ? "Uploading…" : "上传"}
              <input
                type="file"
                disabled={!activeKb || uploading}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        )}

        {/* ─ Body */}
        <div className="grid flex-1 grid-cols-12 gap-4 overflow-hidden">
          {/* ─ Left aside */}
          <aside className="col-span-12 flex min-h-0 flex-col gap-3 overflow-y-auto lg:col-span-3">
            {pageState === "loading" && (
              <LoadingState title="加载中" description="读取 KB 列表 · embedder 信息" />
            )}
            {pageState === "error" && (
              <ErrorState title={error || "加载失败"} />
            )}
            {pageState === "ok" && activeKb && (
              <>
                <KBInfoCard kb={activeKb} onTune={() => setShowTune(true)} />
                <TagsCard docs={docs ?? []} />
                <ToolsCard />
              </>
            )}
            {pageState === "ok" && !activeKb && kbs && kbs.length === 0 && (
              <EmptyState
                title="工作区还没有知识库"
                description="新建一个 KB,开始把笔记 / PDF / 网页 clip 沉淀进来。"
                action={{
                  label: "新建知识库",
                  onClick: () => setShowCreate(true),
                  icon: "plus",
                }}
                icon="book-open"
              />
            )}
          </aside>

          {/* ─ Main canvas */}
          <main className="col-span-12 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface lg:col-span-9">
            {pageState === "ok" && !activeKb ? (
              <div className="flex h-full items-center justify-center px-6 py-12 text-[12px] text-text-muted">
                先在工具栏左侧选择一个知识库
              </div>
            ) : pageState !== "ok" ? null : committedQuery ? (
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
                hasFilter={!!stateFilter}
                onClickDoc={setOpenDoc}
                onUpload={() => {
                  // Trigger the toolbar upload — fastest path is to focus the
                  // hidden input, but simpler: surface a hint.
                  setError('点右上角"上传"按钮添加文档');
                  setTimeout(() => setError(null), 2500);
                }}
              />
            )}
          </main>
        </div>

        {/* ─ Slide-over: Document detail */}
        {openDoc && activeKb && (
          <DocDrawer
            doc={openDoc}
            onClose={() => setOpenDoc(null)}
            onDelete={handleDeleteDoc}
          />
        )}

        {/* ─ Modal: Create KB */}
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

        {/* ─ Modal: Retrieval Tune */}
        {showTune && activeKb && (
          <TuneModal
            kb={activeKb}
            onClose={() => setShowTune(false)}
            onSaved={async (next) => {
              setShowTune(false);
              await refreshKbs(next);
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

function KBInfoCard({ kb, onTune }: { kb: KBDto; onTune: () => void }) {
  const cfg = kb.retrieval_config;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className={SECTION_LABEL}>Knowledge Base</div>
      <div className="mt-1 flex items-start justify-between gap-2">
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
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-y-2 gap-x-3">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            Documents
          </dt>
          <dd className="text-[15px] font-semibold text-text">
            {kb.document_count}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            Chunks
          </dt>
          <dd className="text-[15px] font-semibold text-text">{kb.chunk_count}</dd>
        </div>
        <div className="col-span-2">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            Embedder
          </dt>
          <dd className="truncate font-mono text-[11px] text-text">
            {kb.embedding_model_ref}
          </dd>
          <dd className="font-mono text-[10px] text-text-subtle">
            {kb.embedding_dim}d · cosine
          </dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-border pt-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-subtle">
          Retrieval
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="inline-flex items-center rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-text-muted">
            BM25 ×{cfg.bm25_weight}
          </span>
          <span className="inline-flex items-center rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-text-muted">
            vec ×{cfg.vector_weight}
          </span>
          <span className="inline-flex items-center rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-text-muted">
            top {cfg.top_k}
          </span>
          {cfg.reranker !== "none" && (
            <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary-muted px-1.5 py-0.5 font-mono text-primary">
              {cfg.reranker}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onTune}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
        >
          <Icon name="settings" size={12} />
          调参
        </button>
      </div>
    </div>
  );
}

function TagsCard({ docs }: { docs: DocumentDto[] }) {
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
      <div className={SECTION_LABEL}>Tags</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
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
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className={SECTION_LABEL}>Agent 用法</div>
      <div className="mt-2 space-y-2 text-[12px] leading-relaxed text-text-muted">
        <p>
          给 employee 挂上{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text">
            allhands.skills.kb_researcher
          </code>{" "}
          skill。
        </p>
        <p>
          它会通过{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text">
            kb_search
          </code>{" "}
          /{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text">
            kb_read_document
          </code>{" "}
          主动检索并引用回答。
        </p>
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
}: {
  docs: DocumentDto[];
  allDocsCount: number;
  hasFilter: boolean;
  onClickDoc: (d: DocumentDto) => void;
  onUpload: () => void;
}) {
  if (allDocsCount === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12">
        <EmptyState
          title="知识库为空"
          description="上传第一份文档(支持 md / pdf / docx / html / txt)。Agent 会自动解析、切片、嵌入,数秒内可检索。"
          action={{
            label: "上传文档",
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
        当前过滤器没有命中任何文档
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className={SECTION_LABEL}>Documents</div>
        <span className="font-mono text-[10px] text-text-subtle">
          {docs.length} / {allDocsCount}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2 xl:grid-cols-3">
        {docs.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onClickDoc(d)}
            className="group flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3 text-left transition duration-fast hover:-translate-y-px hover:border-border-strong hover:shadow-soft-sm"
          >
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
                🧩 {d.chunk_count} chunks · v{d.version}
              </span>
              <span>{(d.size_bytes / 1024).toFixed(1)} KB</span>
            </div>
            {d.state_error && (
              <div className="rounded-md border border-danger/30 bg-danger-soft px-2 py-1 text-[10px] text-danger">
                {d.state_error}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
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
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Icon name="search" size={13} className="text-text-subtle" />
          <div className={SECTION_LABEL}>Search Results</div>
          <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text">
            “{query}”
          </span>
        </div>
        {results && (
          <span className="font-mono text-[10px] text-text-subtle">
            {results.length} hit{results.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {searching && (
          <div className="flex h-full items-center justify-center">
            <LoadingState title="检索中" description="BM25 + 向量并发 · RRF 融合" />
          </div>
        )}
        {!searching && results && results.length === 0 && (
          <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
            没有命中 · 试试更具体的关键词,或把 BM25 / vector 权重调一下
          </div>
        )}
        {!searching &&
          results?.map((r, i) => (
            <button
              key={r.chunk_id}
              type="button"
              onClick={() => onChunkClick(r.document_id)}
              className="block w-full rounded-xl border border-border bg-surface-2 p-4 text-left transition duration-fast hover:border-border-strong hover:shadow-soft-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-md bg-primary-muted px-2 py-0.5 font-mono text-[10px] text-primary">
                    #{i + 1}
                  </span>
                  <span className="font-mono text-[11px] text-text-muted">
                    {r.citation}
                  </span>
                  {r.bm25_rank != null && (
                    <span className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
                      BM25 #{r.bm25_rank}
                    </span>
                  )}
                  {r.vector_rank != null && (
                    <span className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
                      vec #{r.vector_rank}
                    </span>
                  )}
                </div>
                <div className="flex flex-col items-end font-mono text-[10px] text-text-subtle">
                  <span>score</span>
                  <span className="text-[12px] text-text">
                    {r.score.toFixed(4)}
                  </span>
                </div>
              </div>
              {r.section_path && (
                <div className="mt-2 font-mono text-[10px] text-text-subtle">
                  {r.section_path}
                </div>
              )}
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[13px] leading-relaxed text-text">
                {r.text}
              </p>
            </button>
          ))}
      </div>
    </div>
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-semibold text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-subtle hover:text-text"
            aria-label="关闭"
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
    hint: `${m.dim}d`,
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
      title="新建知识库"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || submitting}
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40 transition duration-fast"
          >
            {submitting ? "创建中…" : "创建"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="名称">
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Personal Brain"
            className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
        </Field>
        <Field label="描述(可选)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="存什么 · 给谁看 · 任何对未来你有用的备注"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none resize-none"
          />
        </Field>
        <Field label="Embedding model">
          <Select
            value={modelRef}
            onChange={setModelRef}
            options={modelOptions}
            placeholder="选择 embedder"
            className="w-full"
            triggerClassName="h-9 rounded-xl"
            ariaLabel="Embedding model"
          />
          <p className="mt-1 font-mono text-[10px] text-text-subtle">
            灰色项缺少 API key · 在 .env 配置后启用 · 切换需 reindex
          </p>
        </Field>
      </div>
    </ModalShell>
  );
}

function TuneModal({
  kb,
  onClose,
  onSaved,
  onError,
}: {
  kb: KBDto;
  onClose: () => void;
  onSaved: (next: KBDto) => void;
  onError: (msg: string) => void;
}) {
  const [bm25, setBm25] = useState(kb.retrieval_config.bm25_weight);
  const [vec, setVec] = useState(kb.retrieval_config.vector_weight);
  const [topK, setTopK] = useState(kb.retrieval_config.top_k);
  const [reranker, setReranker] = useState(kb.retrieval_config.reranker);
  const [saving, setSaving] = useState(false);

  const rerankerOptions = [
    { value: "none", label: "none — RRF only" },
    { value: "bge-base", label: "bge-base (M3)", disabled: true },
    { value: "cohere", label: "Cohere rerank (M3)", disabled: true },
  ];

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

  return (
    <ModalShell
      title="调检索"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
          >
            取消
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40 transition duration-fast"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="BM25 weight">
          <input
            type="number"
            min={0}
            step={0.1}
            value={bm25}
            onChange={(e) => setBm25(Number(e.target.value))}
            className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text focus:border-border-strong focus:outline-none"
          />
        </Field>
        <Field label="Vector weight">
          <input
            type="number"
            min={0}
            step={0.1}
            value={vec}
            onChange={(e) => setVec(Number(e.target.value))}
            className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text focus:border-border-strong focus:outline-none"
          />
        </Field>
        <Field label="Top K">
          <input
            type="number"
            min={1}
            max={100}
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
            className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text focus:border-border-strong focus:outline-none"
          />
        </Field>
        <Field label="Reranker">
          <Select
            value={reranker}
            onChange={(v) => setReranker(v as "none" | "bge-base" | "cohere")}
            options={rerankerOptions}
            className="w-full"
            triggerClassName="h-9 rounded-xl"
            ariaLabel="Reranker"
          />
        </Field>
      </div>
      <p className="mt-4 font-mono text-[10px] text-text-subtle">
        提示:把 BM25 设 0 试试纯向量召回;调小 top_k 提升召回精度但牺牲覆盖。
      </p>
    </ModalShell>
  );
}

function DocDrawer({
  doc,
  onClose,
  onDelete,
}: {
  doc: DocumentDto;
  onClose: () => void;
  onDelete: (d: DocumentDto) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-bg/40 backdrop-blur-sm">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-surface shadow-soft-lg">
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
              v{doc.version} · {(doc.size_bytes / 1024).toFixed(1)} KB ·{" "}
              {doc.chunk_count} chunks
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-subtle hover:text-text"
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-[12px] leading-relaxed">
          {doc.state_error && (
            <div className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-danger">
              {doc.state_error}
            </div>
          )}

          <DocMetaSection title="Metadata">
            <MetaRow label="ID" value={doc.id} mono />
            <MetaRow label="Mime" value={doc.mime_type} mono />
            <MetaRow label="Source" value={doc.source_type} mono />
            {doc.source_uri && <MetaRow label="URI" value={doc.source_uri} mono />}
            <MetaRow
              label="Created"
              value={new Date(doc.created_at).toLocaleString()}
            />
            <MetaRow
              label="Updated"
              value={new Date(doc.updated_at).toLocaleString()}
            />
          </DocMetaSection>

          {doc.tags.length > 0 && (
            <DocMetaSection title="Tags">
              <div className="flex flex-wrap gap-1.5">
                {doc.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-muted"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </DocMetaSection>
          )}

          <DocMetaSection title="提示">
            <p className="text-text-muted">
              此文档可被任何挂{" "}
              <code className="rounded bg-surface-2 px-1 font-mono text-[11px] text-text">
                kb_researcher
              </code>{" "}
              skill 的 employee 检索;原始文件位于{" "}
              <code className="rounded bg-surface-2 px-1 font-mono text-[11px] text-text">
                data/kb/&lt;kb&gt;/&lt;doc&gt;/v{doc.version}.*
              </code>
              。版本历史在 v0 仅保留最新一份。
            </p>
          </DocMetaSection>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3">
          <button
            type="button"
            onClick={() => onDelete(doc)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-3 text-[12px] text-danger hover:bg-danger/10 transition duration-fast"
          >
            <Icon name="trash-2" size={12} />
            软删除
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
          >
            关闭
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
