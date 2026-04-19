const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type ArtifactKind =
  | "markdown"
  | "code"
  | "html"
  | "image"
  | "data"
  | "mermaid"
  | "drawio"
  | "pptx"
  | "video";

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

const BINARY: ReadonlySet<ArtifactKind> = new Set([
  "image",
  "drawio",
  "pptx",
  "video",
]);

export function isBinaryKind(kind: ArtifactKind): boolean {
  return BINARY.has(kind);
}

export async function listArtifacts(filter: {
  kind?: ArtifactKind;
  namePrefix?: string;
  pinned?: boolean;
  includeDeleted?: boolean;
  limit?: number;
} = {}): Promise<ArtifactDto[]> {
  const qs = new URLSearchParams();
  if (filter.kind) qs.set("kind", filter.kind);
  if (filter.namePrefix) qs.set("name_prefix", filter.namePrefix);
  if (filter.pinned) qs.set("pinned", "true");
  if (filter.includeDeleted) qs.set("include_deleted", "true");
  if (filter.limit != null) qs.set("limit", String(filter.limit));
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

export async function getArtifactTextContent(id: string): Promise<string> {
  const res = await fetch(`${BASE}/api/artifacts/${id}/content`);
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
