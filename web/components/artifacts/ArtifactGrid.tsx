"use client";

/**
 * ArtifactGrid · gallery view alternative to ArtifactList.
 *
 * Reference inspiration:
 *   - Notion / Figma Community: gallery cards with iconographic type tile
 *   - Anthropic Files: large card grid with kind icon front-and-center
 *   - GitHub's "Files" view: dense cards with secondary meta below
 *
 * Each card renders the kind icon on a tinted tile, the artifact name,
 * and a meta row with version + size + relative time. Active selection
 * gets a primary border + glow ring. Pinned artifacts get a small star
 * mark on the corner so they remain spottable in a packed grid.
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/ui/icon";
import { ArtifactPeek } from "./ArtifactPeek";
import type { ArtifactDto, ArtifactKind } from "@/lib/artifacts-api";

const KIND_ICON: Record<ArtifactKind, IconName> = {
  markdown: "file",
  code: "code",
  html: "code",
  image: "eye",
  data: "database",
  mermaid: "activity",
  drawio: "layout-grid",
  pdf: "file",
  xlsx: "database",
  csv: "database",
  docx: "file",
  pptx: "file",
  video: "play-circle",
};

const KIND_TONE: Record<ArtifactKind, string> = {
  markdown: "bg-primary-muted text-primary",
  code: "bg-primary-muted text-primary",
  html: "bg-warning-soft text-warning",
  image: "bg-success-soft text-success",
  data: "bg-surface-2 text-text-muted",
  mermaid: "bg-primary-muted text-primary",
  drawio: "bg-primary-muted text-primary",
  pdf: "bg-danger-soft text-danger",
  xlsx: "bg-success-soft text-success",
  csv: "bg-success-soft text-success",
  docx: "bg-primary-muted text-primary",
  pptx: "bg-warning-soft text-warning",
  video: "bg-surface-2 text-text-muted",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

type RelTimeT = (key: string, values?: Record<string, string | number>) => string;

function relativeTime(iso: string, t: RelTimeT): string {
  const ts = new Date(iso).getTime();
  const diff = Date.now() - ts;
  if (diff < 60_000) return t("justNow");
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 24 * 3600_000) return `${Math.floor(diff / 3600_000)}h`;
  if (diff < 7 * 24 * 3600_000) return `${Math.floor(diff / (24 * 3600_000))}d`;
  return new Date(iso).toISOString().slice(5, 10);
}

export function ArtifactGrid({
  artifacts,
  selectedId,
  bulkSelected,
  onSelect,
  onToggleBulk,
}: {
  artifacts: ArtifactDto[];
  selectedId: string | null;
  bulkSelected?: Set<string>;
  onSelect: (id: string) => void;
  /** Cmd/Ctrl-click toggles bulk membership; plain click sets selectedId. */
  onToggleBulk?: (id: string) => void;
}) {
  const t = useTranslations("artifacts.list");
  const tPeek = useTranslations("artifacts.peek");
  // Stable order: pinned first, then upstream sort (which the page already
  // controls). Group section headers would clutter a grid — we use a tiny
  // pinned star instead so pinned items remain spottable mixed in.
  const ordered = useMemo(() => {
    const pinned = artifacts.filter((a) => a.pinned);
    const rest = artifacts.filter((a) => !a.pinned);
    return [...pinned, ...rest];
  }, [artifacts]);

  if (ordered.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-muted text-primary">
          <Icon name="folder" size={18} />
        </span>
        <p className="text-[12px] text-text-muted">{t("empty")}</p>
      </div>
    );
  }

  return (
    <ul
      role="listbox"
      aria-label={t("groupAria")}
      className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 xl:grid-cols-3"
    >
      {ordered.map((a) => {
        const active = a.id === selectedId;
        const isBulkSelected = bulkSelected?.has(a.id) ?? false;
        const tone = KIND_TONE[a.kind] ?? "bg-surface-2 text-text-muted";
        const icon = KIND_ICON[a.kind] ?? "file";
        return (
          <li key={a.id}>
            <ArtifactPeek artifact={a}>
              {(handlers) => (
            <button
              type="button"
              role="option"
              aria-selected={active}
              onClick={(e) => {
                if ((e.metaKey || e.ctrlKey) && onToggleBulk) {
                  onToggleBulk(a.id);
                  return;
                }
                onSelect(a.id);
              }}
              data-testid={`grid-item-${a.id}`}
              {...handlers}
              className={`group relative flex h-full w-full flex-col gap-2 rounded-xl border p-3 text-left transition-colors duration-fast ${
                isBulkSelected
                  ? "border-primary bg-primary-muted shadow-glow-sm"
                  : active
                  ? "border-primary/50 bg-primary-muted/40 shadow-glow-sm"
                  : "border-border bg-surface hover:border-border-strong hover:bg-surface-2"
              }`}
            >
              {isBulkSelected ? (
                <span
                  aria-hidden
                  className="absolute left-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-fg"
                >
                  <Icon name="check" size={11} />
                </span>
              ) : null}
              {a.pinned ? (
                <span
                  aria-hidden
                  className="absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded text-warning"
                  title={t("pinnedAria")}
                >
                  <Icon name="check" size={11} />
                </span>
              ) : null}
              <div className="flex items-center gap-2">
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${tone}`}>
                  <Icon name={icon} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-[13px] font-semibold ${active ? "text-primary" : "text-text"}`}
                    title={a.name}
                  >
                    {a.name}
                  </div>
                  <div className="truncate font-mono text-[10px] uppercase tracking-wider text-text-subtle">
                    {a.kind}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] text-text-muted">
                <span>v{a.version}</span>
                <span>{formatBytes(a.size_bytes)}</span>
                <span>{relativeTime(a.updated_at, tPeek)}</span>
              </div>
            </button>
              )}
            </ArtifactPeek>
          </li>
        );
      })}
    </ul>
  );
}
