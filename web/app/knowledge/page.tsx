"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
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

/**
 * /knowledge — minimal v0 page for the Knowledge Base.
 *
 * Three columns:
 *  - left:  KB list + "create KB"
 *  - mid:   document list of selected KB + upload + search box
 *  - right: search results (chunks with citation) when a query has run,
 *          otherwise a "tips" panel
 *
 * Visual contract (P8 brand-blue): all colors via Tailwind tokens already
 * mapped on the project; no inline hex. Components stay flat so styling
 * sits in `web/styles/themes/brand-blue/*.css`. The Icon wrapper hides the
 * lucide-react import.
 */
export default function KnowledgePage() {
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

  async function refreshKbs() {
    try {
      const data = await listKBs();
      setKbs(data);
      if (!activeKb && data.length > 0 && data[0]) {
        setActiveKb(data[0]);
      }
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
    refreshKbs();
    listEmbeddingModels()
      .then((m) => {
        setModels(m);
        const def = m.find((x) => x.is_default && x.available) ?? m.find((x) => x.available);
        if (def) setChosenModel(def.ref);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (activeKb) refreshDocs(activeKb.id);
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
      await refreshKbs();
      setActiveKb(kb);
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
      await refreshKbs(); // chunk_count may have changed
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
      <PageHeader
        title="Knowledge Base"
        subtitle="Workspace 级知识库 · Hybrid 检索 · Tool-First 写入"
      />

      {error && (
        <div className="mx-6 mb-4 rounded-md border border-strong bg-soft px-3 py-2 text-sm text-default">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 text-faint hover:text-strong"
          >
            ×
          </button>
        </div>
      )}

      <div className="mx-6 grid grid-cols-12 gap-4 min-h-[600px]">
        {/* Left · KB list */}
        <aside className="col-span-3 card p-4 flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wide text-faint">Knowledge Bases</div>
          <ul className="space-y-1">
            {kbs === null && <li className="text-sm text-faint">loading…</li>}
            {kbs?.length === 0 && (
              <li className="text-sm text-muted">尚未创建 KB · 用下方表单建一个</li>
            )}
            {kbs?.map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  onClick={() => setActiveKb(k)}
                  className={`w-full text-left px-3 py-2 rounded-md transition ${
                    activeKb?.id === k.id
                      ? "bg-primary-soft text-strong"
                      : "text-muted hover:text-strong hover:bg-soft"
                  }`}
                >
                  <div className="text-sm font-medium">{k.name}</div>
                  <div className="text-xs text-faint mt-0.5">
                    {k.document_count} docs · {k.chunk_count} chunks · {k.embedding_dim}d
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-3 border-t border-hairline space-y-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新 KB 名称…"
              className="w-full px-2 py-1.5 text-sm rounded border border-hairline bg-soft text-default"
            />
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wide text-faint">
                Embedding model
              </label>
              <select
                value={chosenModel}
                onChange={(e) => setChosenModel(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-hairline bg-soft text-default"
              >
                {models.map((m) => (
                  <option key={m.ref} value={m.ref} disabled={!m.available}>
                    {m.label} · {m.dim}d{m.is_default ? " · default" : ""}
                    {!m.available ? ` · (${m.reason})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleCreateKB}
              disabled={creating || !newName.trim()}
              className="w-full py-1.5 text-sm rounded bg-primary text-white disabled:opacity-40"
            >
              {creating ? "Creating…" : "+ 新建 KB"}
            </button>
          </div>
        </aside>

        {/* Middle · documents + upload + search */}
        <main className="col-span-5 card p-4 flex flex-col gap-3 min-h-0">
          {!activeKb ? (
            <div className="text-sm text-faint flex items-center justify-center flex-1">
              选择左侧 KB 或新建一个
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-strong font-semibold">{activeKb.name}</div>
                  <div className="text-xs text-faint mt-0.5">
                    {activeKb.embedding_model_ref}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCfg((s) => !s)}
                    className="px-3 py-1.5 text-xs rounded-md border border-hairline text-muted hover:text-strong"
                  >
                    {showCfg ? "Close ⚙" : "⚙ Tune"}
                  </button>
                  <label className="px-3 py-1.5 text-xs rounded-md border border-hairline text-muted hover:text-strong cursor-pointer">
                    {uploading ? "Uploading…" : "+ 上传文档"}
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUpload(f);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>

              {showCfg && (
                <RetrievalConfigEditor
                  kb={activeKb}
                  onSaved={async (next) => {
                    setActiveKb(next);
                    setShowCfg(false);
                    await refreshKbs();
                  }}
                  onError={setError}
                />
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="搜索知识库…  (BM25 + vector + RRF)"
                  className="flex-1 px-3 py-2 text-sm rounded border border-hairline bg-soft text-default"
                />
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={searching || !searchQuery.trim()}
                  className="px-4 py-2 text-sm rounded bg-primary text-white disabled:opacity-40"
                >
                  {searching ? "…" : "Search"}
                </button>
              </div>

              <div className="text-xs uppercase tracking-wide text-faint mt-2">
                Documents ({docs?.length ?? "…"})
              </div>
              <ul className="space-y-2 overflow-y-auto flex-1">
                {docs?.length === 0 && (
                  <li className="text-sm text-faint p-3 text-center border border-dashed border-hairline rounded">
                    KB 为空 · 上传第一份文档
                  </li>
                )}
                {docs?.map((d) => (
                  <li key={d.id} className="card-elev p-3">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="pill mono text-[10px]">
                            {d.mime_type.split("/")[1] || d.mime_type}
                          </span>
                          <span className="text-strong text-sm font-medium truncate">
                            {d.title}
                          </span>
                        </div>
                        <div className="text-xs text-faint flex gap-3">
                          <span>🧩 {d.chunk_count} chunks</span>
                          <span>v{d.version}</span>
                          <span>{(d.size_bytes / 1024).toFixed(1)} KB</span>
                        </div>
                        {d.state_error && (
                          <div className="text-xs text-danger mt-1">{d.state_error}</div>
                        )}
                      </div>
                      <span
                        className={`pill ml-2 ${
                          d.state === "ready"
                            ? "pill-success"
                            : d.state === "failed"
                              ? "pill-danger"
                              : "pill-warning"
                        }`}
                      >
                        {d.state}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </main>

        {/* Right · search results */}
        <aside className="col-span-4 card p-4 flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wide text-faint">
            {results === null ? "Tips" : `Results (${results.length})`}
          </div>
          {results === null && (
            <div className="text-xs text-muted leading-relaxed space-y-2">
              <p>
                <strong>Hybrid search</strong> 把 BM25 全文与向量语义检索通过 RRF 融合 ·
                自动 top-k。
              </p>
              <p>
                Agent 通过 <span className="kbd">kb_search</span> /{" "}
                <span className="kbd">kb_read_document</span> 主动检索;
                带 grant 的 agent 还能 <span className="kbd">kb_create_document</span>{" "}
                沉淀对话产出。
              </p>
              <p>
                试试给一个 employee 挂上 <span className="kbd">allhands.skills.kb_researcher</span>{" "}
                skill,然后问它:「xxx 在我的笔记里讲过吗?」
              </p>
            </div>
          )}
          {results !== null && results.length === 0 && (
            <div className="text-sm text-faint text-center py-8 border border-dashed border-hairline rounded">
              没有命中 · 换个检索词试试
            </div>
          )}
          {results?.map((r) => (
            <div key={r.chunk_id} className="card-elev p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="cite">{r.citation}</span>
                <span className="text-xs text-faint">
                  score {r.score.toFixed(4)}
                </span>
              </div>
              {r.section_path && (
                <div className="text-xs text-faint mb-1.5 mono">{r.section_path}</div>
              )}
              <div className="text-xs text-default leading-relaxed line-clamp-6 whitespace-pre-wrap">
                {r.text}
              </div>
              <div className="text-xs text-faint mt-2 flex gap-3">
                {r.bm25_rank && <span>BM25 #{r.bm25_rank}</span>}
                {r.vector_rank && <span>vec #{r.vector_rank}</span>}
              </div>
            </div>
          ))}
        </aside>
      </div>
    </AppShell>
  );
}

/**
 * Inline retrieval-config editor. Patches via the REST endpoint
 * which mirrors the kb_set_retrieval_config Meta Tool. Sliders are
 * intentionally raw <input type="number"> so the page has no extra
 * dep; styling stays token-only (P8 brand-blue).
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

  return (
    <div className="card-elev p-3 grid grid-cols-2 gap-3 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-faint">BM25 weight</span>
        <input
          type="number"
          min={0}
          step={0.1}
          value={bm25}
          onChange={(e) => setBm25(Number(e.target.value))}
          className="px-2 py-1 rounded border border-hairline bg-soft text-default"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-faint">Vector weight</span>
        <input
          type="number"
          min={0}
          step={0.1}
          value={vec}
          onChange={(e) => setVec(Number(e.target.value))}
          className="px-2 py-1 rounded border border-hairline bg-soft text-default"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-faint">Top K</span>
        <input
          type="number"
          min={1}
          max={100}
          value={topK}
          onChange={(e) => setTopK(Number(e.target.value))}
          className="px-2 py-1 rounded border border-hairline bg-soft text-default"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-faint">Reranker (M3)</span>
        <select
          value={reranker}
          onChange={(e) =>
            setReranker(e.target.value as "none" | "bge-base" | "cohere")
          }
          className="px-2 py-1 rounded border border-hairline bg-soft text-default"
        >
          <option value="none">none</option>
          <option value="bge-base" disabled>
            bge-base (M3)
          </option>
          <option value="cohere" disabled>
            cohere (M3)
          </option>
        </select>
      </label>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="col-span-2 py-1.5 rounded bg-primary text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : "保存"}
      </button>
    </div>
  );
}
