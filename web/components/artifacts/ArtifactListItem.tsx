"use client";

import type { ArtifactDto } from "@/lib/artifacts-api";

const KIND_LABEL: Record<string, string> = {
  markdown: "md",
  code: "code",
  html: "html",
  image: "img",
  data: "data",
  mermaid: "mmd",
  drawio: "drw",
  pptx: "pptx",
  video: "vid",
};

export function ArtifactListItem({
  artifact,
  selected,
  onClick,
}: {
  artifact: ArtifactDto;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex h-12 w-full items-center gap-3 border-b border-border px-3 text-left transition-colors duration-base ${
        selected ? "bg-surface-2" : "hover:bg-surface"
      }`}
    >
      <span className="inline-flex h-6 w-10 shrink-0 items-center justify-center rounded border border-border font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {KIND_LABEL[artifact.kind] ?? artifact.kind}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          {artifact.pinned && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-primary"
              aria-label="pinned"
            />
          )}
          <span className="truncate text-[13px] text-text">{artifact.name}</span>
        </div>
        <span className="truncate font-mono text-[10px] text-text-subtle">
          v{artifact.version} · {new Date(artifact.updated_at).toLocaleString()}
        </span>
      </div>
    </button>
  );
}
