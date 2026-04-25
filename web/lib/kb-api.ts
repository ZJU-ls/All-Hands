/**
 * Knowledge Base API client.
 *
 * Tool-First parity: every endpoint here mirrors a backend Meta Tool
 * (kb_list / kb_search / kb_create_document / etc), so a UI button and
 * an agent-issued tool call exercise the same business path. See
 * `backend/src/allhands/api/routers/knowledge.py`.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export interface KBDto {
  id: string;
  name: string;
  description: string;
  visibility: string;
  embedding_model_ref: string;
  embedding_dim: number;
  document_count: number;
  chunk_count: number;
  retrieval_config: RetrievalConfig;
  created_at: string;
  updated_at: string;
}

export interface DocumentDto {
  id: string;
  kb_id: string;
  title: string;
  mime_type: string;
  state: string;
  state_error: string | null;
  tags: string[];
  chunk_count: number;
  failed_chunk_count: number;
  size_bytes: number;
  version: number;
  pinned: boolean;
  source_type: string;
  source_uri: string | null;
  created_at: string;
  updated_at: string;
}

export interface AskSource {
  n: number;
  chunk_id: number;
  doc_id: string;
  section_path: string | null;
  page: number | null;
  citation: string;
  text: string;
  score: number;
}

export interface AskResponse {
  answer: string;
  sources: AskSource[];
  used_model: string | null;
  latency_ms: number;
}

export async function askKB(
  kbId: string,
  question: string,
  opts: { topK?: number; modelRef?: string } = {},
): Promise<AskResponse> {
  return check(
    await fetch(`${BASE}/api/kb/${kbId}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        top_k: opts.topK ?? 5,
        model_ref: opts.modelRef,
      }),
    }),
    "askKB",
  );
}

export interface DiagnoseDto {
  bm25_only: ScoredChunkDto[];
  vector_only: ScoredChunkDto[];
  hybrid: ScoredChunkDto[];
}

export async function diagnoseSearch(
  kbId: string,
  query: string,
  topK = 8,
): Promise<DiagnoseDto> {
  return check(
    await fetch(`${BASE}/api/kb/${kbId}/search/diagnose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, top_k: topK }),
    }),
    "diagnoseSearch",
  );
}

export interface KBStatsDto {
  count: number;
  avg_latency_ms: number | null;
  recent: Array<{
    at: string;
    query: string;
    latency_ms: number;
    hits: number;
  }>;
}

export async function getKBStats(kbId: string): Promise<KBStatsDto> {
  return check(await fetch(`${BASE}/api/kb/${kbId}/stats`), "getKBStats");
}

export interface DocumentChunkDto {
  id: number;
  ordinal: number;
  text: string;
  token_count: number;
  section_path: string | null;
  span_start: number;
  span_end: number;
  page: number | null;
}

export async function listDocumentChunks(
  kbId: string,
  docId: string,
): Promise<DocumentChunkDto[]> {
  return check(
    await fetch(`${BASE}/api/kb/${kbId}/documents/${docId}/chunks`),
    "listDocumentChunks",
  );
}

export async function getDocumentText(
  kbId: string,
  docId: string,
): Promise<string> {
  const r = await fetch(`${BASE}/api/kb/${kbId}/documents/${docId}/text`);
  if (!r.ok) throw new Error(`getDocumentText failed (${r.status})`);
  const j = (await r.json()) as { content: string };
  return j.content;
}

export interface ScoredChunkDto {
  chunk_id: number;
  document_id: string;
  score: number;
  text: string;
  section_path: string | null;
  page: number | null;
  citation: string;
  bm25_rank: number | null;
  vector_rank: number | null;
}

export interface RetrievalConfig {
  bm25_weight: number;
  vector_weight: number;
  top_k: number;
  min_score: number;
  rerank_top_in: number;
  reranker: "none" | "bge-base" | "cohere";
}

export async function updateRetrievalConfig(
  kbId: string,
  patch: Partial<RetrievalConfig>,
): Promise<KBDto> {
  return check(
    await fetch(`${BASE}/api/kb/${kbId}/retrieval-config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
    "updateRetrievalConfig",
  );
}

export interface EmbeddingModelOption {
  ref: string;
  label: string;
  dim: number;
  available: boolean;
  reason: string | null;
  is_default: boolean;
}

export async function listEmbeddingModels(): Promise<EmbeddingModelOption[]> {
  return check(await fetch(`${BASE}/api/kb/embedding-models`), "listEmbeddingModels");
}

export interface GrantDto {
  id: string;
  kb_id: string;
  scope: string;
  employee_id: string | null;
  skill_id: string | null;
  expires_at: string | null;
  created_at: string;
}

async function check<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${label} failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

export async function listKBs(): Promise<KBDto[]> {
  return check(await fetch(`${BASE}/api/kb`), "listKBs");
}

export async function createKB(payload: {
  name: string;
  description?: string;
  visibility?: string;
  embedding_model_ref?: string;
}): Promise<KBDto> {
  return check(
    await fetch(`${BASE}/api/kb`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    "createKB",
  );
}

export async function getKB(kbId: string): Promise<KBDto> {
  return check(await fetch(`${BASE}/api/kb/${kbId}`), "getKB");
}

export async function deleteKB(kbId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/kb/${kbId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`deleteKB failed (${res.status})`);
}

export async function listDocuments(
  kbId: string,
  opts: { titlePrefix?: string; tag?: string; limit?: number; offset?: number } = {},
): Promise<DocumentDto[]> {
  const qs = new URLSearchParams();
  if (opts.titlePrefix) qs.set("title_prefix", opts.titlePrefix);
  if (opts.tag) qs.set("tag", opts.tag);
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.offset) qs.set("offset", String(opts.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return check(await fetch(`${BASE}/api/kb/${kbId}/documents${suffix}`), "listDocuments");
}

export async function uploadDocument(
  kbId: string,
  file: File,
  opts: { title?: string; tags?: string } = {},
): Promise<DocumentDto> {
  const fd = new FormData();
  fd.set("file", file);
  if (opts.title) fd.set("title", opts.title);
  if (opts.tags) fd.set("tags", opts.tags);
  return check(
    await fetch(`${BASE}/api/kb/${kbId}/documents`, { method: "POST", body: fd }),
    "uploadDocument",
  );
}

export async function deleteDocument(kbId: string, docId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/kb/${kbId}/documents/${docId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`deleteDocument failed (${res.status})`);
}

export async function searchKB(
  kbId: string,
  query: string,
  topK?: number,
): Promise<ScoredChunkDto[]> {
  return check(
    await fetch(`${BASE}/api/kb/${kbId}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, top_k: topK }),
    }),
    "searchKB",
  );
}

export async function listGrants(kbId: string): Promise<GrantDto[]> {
  return check(await fetch(`${BASE}/api/kb/${kbId}/grants`), "listGrants");
}

export async function createGrant(
  kbId: string,
  payload: {
    scope: string;
    employee_id?: string | null;
    skill_id?: string | null;
    expires_at?: string | null;
  },
): Promise<GrantDto> {
  return check(
    await fetch(`${BASE}/api/kb/${kbId}/grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    "createGrant",
  );
}
