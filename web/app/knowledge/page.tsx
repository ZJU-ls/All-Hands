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
  type DiagnoseDto,
  type DocumentChunkDto,
  type DocumentDto,
  type EmbeddingModelOption,
  type KBDto,
  type KBStatsDto,
  type ScoredChunkDto,
  diagnoseSearch,
  getDocumentText,
  getKBStats,
  listDocumentChunks,
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
  const [showSettings, setShowSettings] = useState(false);
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
          subtitle="把资料存进来 · 自己搜得到 · 员工也能引用回答"
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
                    ? `搜 ${activeKb.name} 里的内容…`
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
                <KBInfoCard
                  kb={activeKb}
                  onOpenSettings={() => setShowSettings(true)}
                />
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
                  setError("点右上角「上传」按钮添加文档");
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
            kbId={activeKb.id}
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
 * KB info card · 用户视角 · 不暴露 BM25/RRF/dim/cosine 等术语。
 *
 * 三个层次:
 *   1. 名字 + 简介 + 设置 设置入口
 *   2. 一句话能力简述 (e.g. "✓ 启用了语义检索" / "演示模式 · 检索只能匹配关键词")
 *   3. 数字: "5 段内容 · 来自 2 份资料"
 *
 * 检索权重 / embedder 维度等技术细节都收进 设置 设置弹窗的"高级"分组。
 */
function KBInfoCard({
  kb,
  onOpenSettings,
}: {
  kb: KBDto;
  onOpenSettings: () => void;
}) {
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
          aria-label="知识库设置"
          title="设置"
          className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-surface text-text-subtle hover:border-border-strong hover:text-text transition duration-fast"
        >
          <Icon name="settings" size={12} />
        </button>
      </div>

      {/* 内容统计 — 友好语言,不用 documents/chunks 的英文术语 */}
      <div className="mt-3 flex items-baseline gap-3 text-[13px] text-text">
        <span>
          <span className="font-semibold">{kb.document_count}</span>
          <span className="ml-1 text-text-muted">份资料</span>
        </span>
        <span className="text-text-subtle">·</span>
        <span>
          <span className="font-semibold">{kb.chunk_count}</span>
          <span className="ml-1 text-text-muted">段内容</span>
        </span>
      </div>

      {/* 能力提示 — mock 高亮警示;真实 provider 静默 ✓ */}
      {isMock ? (
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-3 block w-full rounded-lg border border-warning/40 bg-warning-soft p-3 text-left text-[12px] text-warning hover:bg-warning/10 transition duration-fast"
        >
          <div className="flex items-center gap-1.5 font-medium">
            <Icon name="alert-triangle" size={12} />
            <span>当前是演示模式</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed">
            检索只能匹配关键词,不懂语义近义词。
            <span className="underline">点这里换成真实模型 →</span>
          </p>
        </button>
      ) : (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-[12px] text-success">
          <Icon name="check" size={12} />
          <span>已启用语义检索</span>
        </div>
      )}
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
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text">
        <Icon name="users" size={13} className="text-primary" />
        让员工帮你查
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-text-muted">
        在「员工」页给某个员工加上「<span className="text-text">知识库研究员</span>」技能,
        TA 在对话里就能搜这个 KB 并引用原文回答你。
      </p>
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
            <LoadingState title="检索中…" description="正在并发匹配关键词和语义" />
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

/**
 * KBSettingsModal — 知识库设置(基础 / 高级 / 危险三 tab)。
 *
 * 设计目标:把所有跟 KB 相关的"调整"都收拢到这里 · 不要散落在 sidebar /
 * KB 卡上。基础 tab 用大白话讲清"我现在的智能水平靠什么";高级 tab 才暴
 * 露 BM25 / 向量 / top_k 等真正的调参旋钮;危险 tab 单独放删除。
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
  type Tab = "basic" | "advanced" | "diagnose" | "danger";
  const [tab, setTab] = useState<Tab>("basic");

  // Advanced state
  const [bm25, setBm25] = useState(kb.retrieval_config.bm25_weight);
  const [vec, setVec] = useState(kb.retrieval_config.vector_weight);
  const [topK, setTopK] = useState(kb.retrieval_config.top_k);
  const [reranker, setReranker] = useState(kb.retrieval_config.reranker);
  const [saving, setSaving] = useState(false);

  const rerankerOptions = [
    { value: "none", label: "标准融合(默认)" },
    { value: "bge-base", label: "bge-base — 二次排序", disabled: true, hint: "M3" },
    { value: "cohere", label: "Cohere rerank", disabled: true, hint: "M3" },
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
    { id: "basic", label: "基础", icon: "info" },
    { id: "diagnose", label: "调试检索", icon: "search" },
    { id: "advanced", label: "高级", icon: "settings" },
    { id: "danger", label: "危险", icon: "trash-2" },
  ];

  return (
    <ModalShell
      title={`${kb.name} · 设置`}
      onClose={onClose}
      footer={
        tab === "advanced" ? (
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
              onClick={saveAdvanced}
              disabled={saving}
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40 transition duration-fast"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:border-border-strong hover:text-text transition duration-fast"
          >
            关闭
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
        <BasicTab kb={kb} models={models} />
      )}

      {/* Advanced tab — retrieval tune */}
      {tab === "advanced" && (
        <div className="space-y-4">
          <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-text-muted">
            一般不用动。两个权重控制&ldquo;关键词命中&rdquo;和&ldquo;语义匹配&rdquo;哪个更重要;<br />
            <span className="font-mono text-[11px]">top k</span> 是每次检索返回的最大段数。
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="关键词命中(BM25)">
              <input
                type="number"
                min={0}
                step={0.1}
                value={bm25}
                onChange={(e) => setBm25(Number(e.target.value))}
                className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text focus:border-border-strong focus:outline-none"
              />
            </Field>
            <Field label="语义匹配(向量)">
              <input
                type="number"
                min={0}
                step={0.1}
                value={vec}
                onChange={(e) => setVec(Number(e.target.value))}
                className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text focus:border-border-strong focus:outline-none"
              />
            </Field>
            <Field label="返回多少段">
              <input
                type="number"
                min={1}
                max={100}
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text focus:border-border-strong focus:outline-none"
              />
            </Field>
            <Field label="二次排序">
              <Select
                value={reranker}
                onChange={(v) => setReranker(v as "none" | "bge-base" | "cohere")}
                options={rerankerOptions}
                className="w-full"
                triggerClassName="h-9 rounded-xl"
                ariaLabel="二次排序"
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
 * 调试检索 tab — same query, three lenses, side-by-side. Helps users
 * see what BM25 alone returns vs. vector alone vs. hybrid, so the
 * "为什么没召回" / "为什么这条排第一" question becomes visible instead
 * of magic.
 */
function DiagnoseTab({ kb }: { kb: KBDto }) {
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
          placeholder="输一个 query 看三种召回的对比…"
          className="h-9 flex-1 rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
        />
        <button
          type="button"
          onClick={run}
          disabled={running || !query.trim()}
          className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-[12px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-40 transition duration-fast"
        >
          {running ? "…" : "对比"}
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
            title="只看关键词"
            subtitle="BM25"
            tone="warning"
            results={out.bm25_only}
          />
          <DiagnoseColumn
            title="只看语义"
            subtitle="Vector"
            tone="primary"
            results={out.vector_only}
          />
          <DiagnoseColumn
            title="融合(默认)"
            subtitle="Hybrid · RRF"
            tone="success"
            results={out.hybrid}
          />
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-text-muted">
          输个 query,左边是只看关键词的命中,中间是只看语义的命中,右边是融合后的最终顺序。
          相同段在三栏的位次差异能告诉你 BM25 和向量哪个更&ldquo;懂&rdquo;这个查询。
        </p>
      )}

      {stats && stats.count > 0 && (
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
            <span>本进程检索统计</span>
            <span>
              {stats.count} 次 · 均 {stats.avg_latency_ms?.toFixed(0)} ms
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
                  {r.hits} 命中 · {r.latency_ms.toFixed(0)} ms
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
            没命中
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
}: {
  kb: KBDto;
  models: EmbeddingModelOption[];
}) {
  const isMock = kb.embedding_model_ref.startsWith("mock:");
  const realAvailable = models.filter(
    (m) => !m.ref.startsWith("mock:") && m.available,
  );

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
          {isMock ? "演示模式 · 检索靠关键词匹配" : "已启用语义检索"}
        </div>
        <p
          className={`mt-1.5 text-[12px] leading-relaxed ${
            isMock ? "text-warning/90" : "text-success/90"
          }`}
        >
          {isMock
            ? "搜「相机」不会命中「摄像机」。要理解语义近义词,需要绑一个真实的 embedding 模型。"
            : "搜「相机」能命中「摄像机」等近义表达。"}
        </p>
        <div className="mt-2 font-mono text-[10px] text-text-subtle">
          当前 · {kb.embedding_model_ref}
        </div>
      </div>

      {/* Provider sourcing — pulls from /gateway, no .env */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
            可用的真实模型
          </span>
          <a
            href="/gateway"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            管理 provider
            <Icon name="external-link" size={11} />
          </a>
        </div>

        {realAvailable.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface-2 p-4 text-[12px] text-text-muted">
            <div className="mb-2 flex items-center gap-2 font-medium text-text">
              <Icon name="info" size={13} className="text-primary" />
              还没有可用的 embedding 模型
            </div>
            <p className="leading-relaxed">
              去「<a href="/gateway" className="text-primary underline">模型网关</a>」
              添加一个 OpenAI 或阿里云百炼 provider · 填上 API key,这里就会出现可用模型列表。
            </p>
            <a
              href="/gateway"
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg hover:bg-primary-hover transition duration-fast"
            >
              <Icon name="plus" size={12} />
              去配置
            </a>
          </div>
        ) : (
          <>
            <ul className="space-y-1.5">
              {realAvailable.map((m) => (
                <li
                  key={m.ref}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px]"
                >
                  <span className="text-text">{m.label}</span>
                  <span className="font-mono text-[10px] text-text-subtle">
                    {m.dim}d
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px] text-text-muted">
              <Icon name="info" size={11} className="-mt-px mr-1 inline-block" />
              切换 KB 的 embedding 模型需要重算所有&ldquo;语义指纹&rdquo;(reindex)·
              v0 暂不支持热切换。要换模型,先删了这个 KB,再用新模型新建。
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
  const [confirm, setConfirm] = useState("");
  const enabled = confirm === kb.name;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-danger/30 bg-danger-soft p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-danger">
          <Icon name="alert-triangle" size={14} />
          删除知识库
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-danger/90">
          软删除 · 30 天内可联系管理员恢复;之后所有文档 / 向量数据物理移除。
          原始上传文件留在磁盘上(<code className="font-mono text-[11px]">data/kb/{kb.id.slice(0, 8)}…</code>),
          需要手动清理。
        </p>
      </div>

      <Field label={`输入 KB 名称「${kb.name}」以确认`}>
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
        永久删除
      </button>
    </div>
  );
}

function DocDrawer({
  doc,
  kbId,
  onClose,
  onDelete,
}: {
  doc: DocumentDto;
  kbId: string;
  onClose: () => void;
  onDelete: (d: DocumentDto) => void;
}) {
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
    { id: "info", label: "概览", icon: "info" },
    { id: "text", label: "原文", icon: "file" },
    {
      id: "chunks",
      label: `分片 (${doc.chunk_count})`,
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
              v{doc.version} · {(doc.size_bytes / 1024).toFixed(1)} KB ·{" "}
              {doc.chunk_count} 段
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
              <DocMetaSection title="基本信息">
                <MetaRow label="ID" value={doc.id} mono />
                <MetaRow label="Mime" value={doc.mime_type} mono />
                <MetaRow label="来源" value={doc.source_type} mono />
                {doc.source_uri && (
                  <MetaRow label="URI" value={doc.source_uri} mono />
                )}
                <MetaRow
                  label="创建"
                  value={new Date(doc.created_at).toLocaleString()}
                />
                <MetaRow
                  label="更新"
                  value={new Date(doc.updated_at).toLocaleString()}
                />
              </DocMetaSection>
              {doc.tags.length > 0 && (
                <DocMetaSection title="标签">
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
            </div>
          )}

          {tab === "text" && (
            <div className="p-5">
              {loading && text === null ? (
                <LoadingState title="加载原文…" />
              ) : textErr ? (
                <ErrorState title={textErr} />
              ) : text === null || text.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12px] text-text-muted">
                  文件为空或不可读
                </div>
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
                  title="加载分片…"
                  description="读取每段的位置 / section / 页码"
                />
              ) : chunks === null || chunks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12px] text-text-muted">
                  这个文档没有分片(可能解析为空)
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
                          {c.span_start}–{c.span_end} · ~{c.token_count} tokens
                        </span>
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
