"use client";

/**
 * ArtifactListItem · one row in the artifacts sidebar. V2-level (ADR 0016).
 *
 * - Default: transparent row, `hover:bg-surface-2`.
 * - Selected: `bg-primary-muted` + 2px left `bg-primary` accent bar.
 * - Kind badge: small gradient/muted tile with an icon glyph.
 */

import { useLocale, useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/ui/icon";
import type { ArtifactDto } from "@/lib/artifacts-api";

// 2026-04-27 · 必须含全部 12 个 backend ArtifactKind enum 值。之前漏掉
// csv/xlsx/docx/pdf · 这些行在 sidebar 显示原始 kind 字符串("csv")
// 而不是更易读的 3-letter 缩写,且图标 fallback 到通用 "file" 与同类
// office 文件不区分。删了"video"幽灵 — backend enum 没有 video。
const KIND_LABEL: Record<string, string> = {
  markdown: "md",
  code: "code",
  html: "html",
  image: "img",
  data: "data",
  mermaid: "mmd",
  drawio: "drw",
  csv: "csv",
  xlsx: "xlsx",
  docx: "docx",
  pdf: "pdf",
  pptx: "pptx",
};

// 图标按"看一眼就知道是啥"的语义贴:
//   csv/xlsx → table(数据网格)· database 留给真正的 data 类
//   docx → file-text(文档)
//   pdf → file(通用)· lucide 没有 pdf 专属 icon
//   pptx → file(通用)· presentation icon 在 lucide 里没有
const KIND_ICON: Record<string, IconName> = {
  markdown: "book-open",
  code: "code",
  html: "code",
  image: "eye",
  data: "database",
  mermaid: "activity",
  drawio: "activity",
  csv: "table",
  xlsx: "table",
  docx: "file-text",
  pdf: "file",
  pptx: "file",
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
  const icon = KIND_ICON[artifact.kind] ?? "file";
  const label = KIND_LABEL[artifact.kind] ?? artifact.kind;
  const locale = useLocale();
  const t = useTranslations("artifacts.list");

  return (
    <li className="relative">
      {selected && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary"
        />
      )}
      <button
        type="button"
        onClick={onClick}
        className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-fast ease-out ${
          selected
            ? "bg-primary-muted text-text"
            : "text-text hover:bg-surface-2"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            selected
              ? "bg-surface text-primary shadow-soft-sm"
              : "bg-surface-2 text-text-muted group-hover:bg-surface group-hover:text-text"
          }`}
        >
          <Icon name={icon} size={14} strokeWidth={2} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            {artifact.pinned && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-primary"
                aria-label={t("pinnedAria")}
              />
            )}
            <span className="truncate text-[13px] font-medium text-text">
              {artifact.name}
            </span>
          </div>
          <span className="truncate font-mono text-[10px] text-text-subtle">
            v{artifact.version} · {new Date(artifact.updated_at).toLocaleString(locale)}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-text-subtle">
          {label}
        </span>
      </button>
    </li>
  );
}
