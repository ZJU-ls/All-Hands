"use client";

import { useMemo } from "react";
import type { ArtifactDto } from "@/lib/artifacts-api";
import { ArtifactListItem } from "./ArtifactListItem";

const KIND_ORDER = [
  "markdown",
  "code",
  "html",
  "image",
  "data",
  "mermaid",
  "drawio",
  "pptx",
  "video",
] as const;

export function ArtifactList({
  artifacts,
  selectedId,
  onSelect,
}: {
  artifacts: ArtifactDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const pinned = artifacts.filter((a) => a.pinned);
    const rest = artifacts.filter((a) => !a.pinned);
    const byKind = new Map<string, ArtifactDto[]>();
    for (const a of rest) {
      const bucket = byKind.get(a.kind) ?? [];
      bucket.push(a);
      byKind.set(a.kind, bucket);
    }
    const sections: { title: string; items: ArtifactDto[] }[] = [];
    if (pinned.length > 0) sections.push({ title: "置顶", items: pinned });
    for (const kind of KIND_ORDER) {
      const items = byKind.get(kind);
      if (items && items.length > 0) sections.push({ title: kind, items });
    }
    return sections;
  }, [artifacts]);

  if (artifacts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-text-muted">
        还没有制品。让员工产出一份文档、代码或图。
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {grouped.map((section) => (
        <div key={section.title}>
          <div className="px-3 mt-3 mb-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-text-subtle">
            {section.title}
          </div>
          {section.items.map((a) => (
            <ArtifactListItem
              key={a.id}
              artifact={a}
              selected={a.id === selectedId}
              onClick={() => onSelect(a.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
