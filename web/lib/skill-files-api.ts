/**
 * Skill Files API client · backs the Files tab on /skills/{id}.
 *
 * Endpoints (see backend/src/allhands/api/routers/skills.py):
 *   GET    /api/skills/{id}/files?include_manifest=bool
 *   GET    /api/skills/{id}/files/content?path=...
 *   PUT    /api/skills/{id}/files/content?path=...
 *   DELETE /api/skills/{id}/files/content?path=...
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type SkillFileEntry = {
  relative_path: string;
  size_bytes: number;
};

export type SkillFileContent = {
  relative_path: string;
  size_bytes: number;
  content: string;
  encoding: "utf-8" | "binary";
  editable: boolean;
};

export async function listSkillFiles(
  skillId: string,
  opts: { includeManifest?: boolean } = {},
): Promise<SkillFileEntry[]> {
  const params = new URLSearchParams();
  if (opts.includeManifest) params.set("include_manifest", "true");
  const url = `${BASE}/api/skills/${encodeURIComponent(skillId)}/files${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { files: SkillFileEntry[] };
  return body.files;
}

export async function readSkillFile(
  skillId: string,
  relativePath: string,
): Promise<SkillFileContent> {
  const params = new URLSearchParams({ path: relativePath });
  const res = await fetch(
    `${BASE}/api/skills/${encodeURIComponent(skillId)}/files/content?${params.toString()}`,
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  return (await res.json()) as SkillFileContent;
}

export async function writeSkillFile(
  skillId: string,
  relativePath: string,
  content: string,
): Promise<SkillFileContent> {
  const params = new URLSearchParams({ path: relativePath });
  const res = await fetch(
    `${BASE}/api/skills/${encodeURIComponent(skillId)}/files/content?${params.toString()}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  return (await res.json()) as SkillFileContent;
}

export async function deleteSkillFile(
  skillId: string,
  relativePath: string,
): Promise<void> {
  const params = new URLSearchParams({ path: relativePath });
  const res = await fetch(
    `${BASE}/api/skills/${encodeURIComponent(skillId)}/files/content?${params.toString()}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
}
