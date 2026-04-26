"use client";

/**
 * ArtifactListItem · one row in the artifacts sidebar. V2-level (ADR 0016).
 *
 * - Default: transparent row, `hover:bg-surface-2`.
 * - Selected: `bg-primary-muted` + 2px left `bg-primary` accent bar.
 * - Kind badge: small gradient/muted tile with an icon glyph.
 */

import { useLocale } from "next-intl";
import { Icon, type IconName } from "@/components/ui/icon";
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

const KIND_ICON: Record<string, IconName> = {
  markdown: "book-open",
  code: "code",
  html: "code",
  image: "eye",
  data: "database",
  mermaid: "activity",
  drawio: "activity",
  pptx: "file",
  video: "play-circle",
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
                aria-label="pinned"
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
