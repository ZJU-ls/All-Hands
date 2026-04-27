"use client";

/**
 * ArtifactList · grouped sidebar list of artifacts. V2-level (ADR 0016).
 *
 * Grouping: pinned → per-kind (stable order). Section titles are rendered
 * literally ("置顶", "markdown", "image", …) because the panel test asserts
 * on those exact strings.
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import type { ArtifactDto } from "@/lib/artifacts-api";
import { ArtifactListItem } from "./ArtifactListItem";

// 2026-04-27 · 必须含全部 12 个 backend ArtifactKind enum 值。之前漏了
// csv/xlsx/docx/pdf,导致这些类型的制品在分组列表里被静默丢弃 — 用户筛
// csv 时左侧空白却显示 "2 个制品"。多余的 video 已从前端类型中移除。
// 顺序按"易读优先":先 prose / 工程产物,再 office / data。
const KIND_ORDER = [
  "markdown",
  "code",
  "html",
  "image",
  "data",
  "mermaid",
  "drawio",
  "csv",
  "xlsx",
  "docx",
  "pdf",
  "pptx",
] as const;

// 兜底:如果 backend 新增了一个我们前端还没追上的 kind,fallback 到
// 一个 "其他" 分组,而不是静默丢弃 — 比硬抛掉更稳。
const FALLBACK_BUCKET = "other";

export function ArtifactList({
  artifacts,
  selectedId,
  onSelect,
}: {
  artifacts: ArtifactDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("artifacts.list");
  const grouped = useMemo(() => {
    const pinned = artifacts.filter((a) => a.pinned);
    const rest = artifacts.filter((a) => !a.pinned);
    const byKind = new Map<string, ArtifactDto[]>();
    const known = new Set<string>(KIND_ORDER);
    for (const a of rest) {
      // 把"未识别 kind"统一收到 FALLBACK_BUCKET,确保即使 backend 新
      // 增枚举,前端也不会把这部分制品静默吞掉。
      const key = known.has(a.kind) ? a.kind : FALLBACK_BUCKET;
      const bucket = byKind.get(key) ?? [];
      bucket.push(a);
      byKind.set(key, bucket);
    }
    const sections: { title: string; items: ArtifactDto[] }[] = [];
    if (pinned.length > 0) sections.push({ title: t("pinned"), items: pinned });
    for (const kind of KIND_ORDER) {
      const items = byKind.get(kind);
      if (items && items.length > 0) sections.push({ title: kind, items });
    }
    const fallback = byKind.get(FALLBACK_BUCKET);
    if (fallback && fallback.length > 0) {
      sections.push({ title: t("groupOther"), items: fallback });
    }
    return sections;
  }, [artifacts, t]);

  if (artifacts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-muted text-primary">
          <Icon name="folder" size={18} />
        </span>
        <p className="text-[12px] text-text-muted">
          {t("empty")}
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
