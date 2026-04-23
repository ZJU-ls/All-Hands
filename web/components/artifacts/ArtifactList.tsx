"use client";

/**
 * ArtifactList · grouped sidebar list of artifacts. V2-level (ADR 0016).
 *
 * Grouping: pinned → per-kind (stable order). Section titles are rendered
 * literally ("置顶", "markdown", "image", …) because the panel test asserts
 * on those exact strings.
 */

import { useMemo } from "react";
import { Icon } from "@/components/ui/icon";
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
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-muted text-primary">
          <Icon name="folder" size={18} />
        </span>
        <p className="text-[12px] text-text-muted">
          还没有制品。让员工产出一份文档、代码或图。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {grouped.map((section) => (
        <section key={section.title} className="flex flex-col">
          <div className="mb-1 mt-3 flex items-center gap-2 px-3">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-text-subtle">
              {section.title}
            </span>
            <span className="h-px flex-1 bg-border/60" />
            <span className="font-mono text-[10px] text-text-subtle">
              {section.items.length}
            </span>
          </div>
          <ul className="flex flex-col gap-1 px-2">
            {section.items.map((a) => (
              <ArtifactListItem
                key={a.id}
                artifact={a}
                selected={a.id === selectedId}
                onClick={() => onSelect(a.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
