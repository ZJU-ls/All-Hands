const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

// 2026-04-27 · 严格对齐 backend ArtifactKind enum
// (backend/src/allhands/core/artifact.py)。原前端含"video"是幽灵类型,
// 后端从未支持 — 这种 frontend-only 类型一旦在 KIND_ICON / Record map
// 里被消费,会让 TS 编译通过但运行时 backend 永远不会发送 → 死代码 +
// 误导用户(filter 下拉里能选 video,但永远 0 个结果)。
// 真正要支持视频时,先在后端加 enum,再扩前端。
export type ArtifactKind =
  | "markdown"
  | "code"
  | "html"
  | "image"
  | "data"
  | "mermaid"
  | "drawio"
  | "pdf"
  | "xlsx"
  | "csv"
  | "docx"
  | "pptx";

export type ArtifactDto = {
  id: string;
  workspace_id: string;
  name: string;
  kind: ArtifactKind;
  mime_type: string;
  size_bytes: number;
  version: number;
  pinned: boolean;
  deleted_at: string | null;
  conversation_id: string | null;
  created_by_employee_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ArtifactVersionDto = {
  version: number;
  created_at: string;
  size_bytes: number;
  has_diff: boolean;
};

export type ArtifactContentDto = {
  id: string;
  version: number;
  kind: ArtifactKind;
  mime_type: string;
  content: string | null;
  content_base64: string | null;
  truncated: boolean;
};

// drawio + csv are text-identity (XML / CSV both round-trip as utf-8). The
// rest of the office family (pdf / xlsx / docx / pptx) lands as binary blobs
// the LLM never reads back as raw text — viewers fetch via /content
// directly. Image stays binary.
const BINARY: ReadonlySet<ArtifactKind> = new Set([
  "image",
  "pdf",
  "xlsx",
  "docx",
  "pptx",
]);

export function isBinaryKind(kind: ArtifactKind): boolean {
  return BINARY.has(kind);
}

export type ArtifactSort =
  | "updated_at_desc"
  | "created_at_desc"
  | "created_at_asc"
  | "name_asc"
  | "name_desc"
  | "size_desc";

export type ArtifactListFilter = {
  kind?: ArtifactKind;
  namePrefix?: string;
  pinned?: boolean;
  includeDeleted?: boolean;
  limit?: number;
  // 2026-04-25 v2 · multi-dim filters for /artifacts global page.
  conversationId?: string;
  employeeId?: string;
  status?: string;
  tag?: string;
  q?: string;
  sort?: ArtifactSort;
  createdAfter?: string;
  createdBefore?: string;
};

export type ContributorEntry = { key: string; count: number };

export type ArtifactStatsDto = {
  total: number;
  pinned: number;
  last_7d: number;
  total_bytes: number;
  by_kind: Record<string, number>;
  largest_kind: string | null;
  latest_updated_at: string | null;
  /** 14-day daily creation histogram, oldest → newest. */
  daily_counts: number[];
  /** Top 5 employees by artifact count. */
  top_employees: ContributorEntry[];
};

export async function getArtifactStats(): Promise<ArtifactStatsDto> {
  const res = await fetch(`${BASE}/api/artifacts/stats`);
  if (!res.ok) throw new Error(`getArtifactStats failed: ${res.status}`);
  return res.json() as Promise<ArtifactStatsDto>;
}

export async function listArtifacts(
  filter: ArtifactListFilter = {},
): Promise<ArtifactDto[]> {
  const qs = new URLSearchParams();
  if (filter.kind) qs.set("kind", filter.kind);
  if (filter.namePrefix) qs.set("name_prefix", filter.namePrefix);
  if (filter.pinned) qs.set("pinned", "true");
  if (filter.includeDeleted) qs.set("include_deleted", "true");
  if (filter.limit != null) qs.set("limit", String(filter.limit));
  if (filter.conversationId) qs.set("conversation_id", filter.conversationId);
  if (filter.employeeId) qs.set("employee_id", filter.employeeId);
  if (filter.status) qs.set("status", filter.status);
  if (filter.tag) qs.set("tag", filter.tag);
  if (filter.q) qs.set("q", filter.q);
  if (filter.sort) qs.set("sort", filter.sort);
  if (filter.createdAfter) qs.set("created_after", filter.createdAfter);
  if (filter.createdBefore) qs.set("created_before", filter.createdBefore);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`${BASE}/api/artifacts${suffix}`);
  if (!res.ok) throw new Error(`listArtifacts failed: ${res.status}`);
  return res.json() as Promise<ArtifactDto[]>;
}

export async function getArtifact(id: string): Promise<ArtifactDto> {
  const res = await fetch(`${BASE}/api/artifacts/${id}`);
  if (!res.ok) throw new Error(`getArtifact failed: ${res.status}`);
  return res.json() as Promise<ArtifactDto>;
}

export class ArtifactContentMissingError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ArtifactContentMissingError";
    this.status = status;
  }
}

export async function getArtifactTextContent(id: string): Promise<string> {
  const res = await fetch(`${BASE}/api/artifacts/${id}/content`);
  if (res.status === 404) {
    // Backend distinguishes "no such artifact" from "row exists but file
    // gone" (ArtifactContentMissing → 404 with descriptive detail). Surface
    // it as a typed error so the UI can render an empty-state instead of
    // a red "Failed: 404".
    throw new ArtifactContentMissingError(
      "artifact content is missing on disk",
      404,
    );
  }
  if (!res.ok) throw new Error(`getArtifactTextContent failed: ${res.status}`);
  return res.text();
}

export async function getArtifactBinaryUrl(id: string): Promise<string> {
  return `${BASE}/api/artifacts/${id}/content`;
}

/** URL for the artifact SSE feed — consumed by `ArtifactPanel` via `EventSource`.
 * The server emits `artifact_changed` frames for create / update / delete / pin
 * (I-0005). Frames carry only the id + op; clients refetch the affected record. */
export function artifactStreamUrl(): string {
  return `${BASE}/api/artifacts/stream`;
}

export type ArtifactChangedOp = "created" | "updated" | "deleted" | "pinned";

export type ArtifactChangedPayload = {
  workspace_id: string;
  artifact_id: string;
  artifact_kind: string;
  op: ArtifactChangedOp;
  version: number;
  conversation_id: string | null;
};

export type ArtifactChangedFrame = {
  id: string;
  kind: "artifact_changed";
  ts: string;
  payload: ArtifactChangedPayload;
};

export async function listArtifactVersions(id: string): Promise<ArtifactVersionDto[]> {
  const res = await fetch(`${BASE}/api/artifacts/${id}/versions`);
  if (!res.ok) throw new Error(`listArtifactVersions failed: ${res.status}`);
  return res.json() as Promise<ArtifactVersionDto[]>;
}

export async function getArtifactVersionContent(
  id: string,
  version: number,
): Promise<ArtifactContentDto> {
  const res = await fetch(`${BASE}/api/artifacts/${id}/versions/${version}/content`);
  if (!res.ok) throw new Error(`getArtifactVersionContent failed: ${res.status}`);
  return res.json() as Promise<ArtifactContentDto>;
}

/**
 * Edit an artifact's content (P1 panel edit). Returns the updated artifact
 * (new version). Server bumps version and writes a new file on disk.
 */
export async function updateArtifact(
  id: string,
  body: { content?: string; content_base64?: string; mode?: "overwrite" | "patch"; patch?: string },
): Promise<ArtifactDto> {
  const res = await fetch(`${BASE}/api/artifacts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "overwrite", ...body }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`updateArtifact failed: ${res.status} ${detail}`);
  }
  return res.json() as Promise<ArtifactDto>;
}

/** Pin / unpin · REST mirror of the artifact_pin meta tool. */
export async function pinArtifact(
  id: string,
  pinned: boolean,
): Promise<ArtifactDto> {
  const res = await fetch(`${BASE}/api/artifacts/${id}/pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`pinArtifact failed: ${res.status} ${detail}`);
  }
  return res.json() as Promise<ArtifactDto>;
}

/** Soft-delete · REST mirror of the artifact_delete meta tool. */
export async function deleteArtifact(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/artifacts/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const detail = await res.text();
    throw new Error(`deleteArtifact failed: ${res.status} ${detail}`);
  }
}

/**
 * Roll back to an older version. Creates a new v{N+1} carrying the older
 * version's content; original history is preserved.
 */
export async function rollbackArtifact(
  id: string,
  to_version: number,
): Promise<ArtifactDto> {
  const res = await fetch(`${BASE}/api/artifacts/${id}/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to_version }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`rollbackArtifact failed: ${res.status} ${detail}`);
  }
  return res.json() as Promise<ArtifactDto>;
}
