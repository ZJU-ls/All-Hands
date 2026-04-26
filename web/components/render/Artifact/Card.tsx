"use client";

/**
 * Artifact.Card · render target for artifacts that don't inline well in chat.
 *
 * Used for pptx / docx / large pdf / oversized markdown / oversized code.
 * The agent created the artifact (it lives in the panel) — the chat shows a
 * compact card pointing to it. Clicking opens the artifact panel scoped to
 * this artifact.
 *
 * Wired by `_pick_artifact_envelope` (backend executors.py). For inline-
 * renderable kinds, the agent emits Artifact.Preview instead.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/ui/icon";
import { useArtifactFocus } from "@/lib/artifact-focus-store";
import { getArtifact, type ArtifactDto } from "@/lib/artifacts-api";
import type { RenderProps } from "@/lib/component-registry";

const KIND_ICON: Record<string, IconName> = {
  markdown: "book-open",
  code: "code",
  html: "code",
  image: "eye",
  data: "database",
  mermaid: "activity",
  drawio: "activity",
  pdf: "file",
  xlsx: "database",
  csv: "database",
  docx: "book-open",
  pptx: "file",
};

const KIND_GLYPH_BG: Record<string, string> = {
  // Brand-blue for default, warm for office docs, cyan for data
  pptx: "linear-gradient(135deg, #f97316 0%, #ef4444 100%)",
  docx: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
  pdf: "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)",
  xlsx: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
  csv: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
  markdown: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
  code: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
  drawio: "linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)",
  mermaid: "linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)",
  html: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
  data: "linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)",
  image: "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ArtifactCard({ props }: RenderProps) {
  const t = useTranslations("render.artifactCard");
  const artifactId = (props.artifact_id as string | undefined) ?? "";
  const presetKind = (props.kind as string | undefined) ?? "";
  const focusArtifact = useArtifactFocus((s) => s.focus);

  const [meta, setMeta] = useState<ArtifactDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!artifactId) return;
    let cancelled = false;
    void (async () => {
      try {
        const m = await getArtifact(artifactId);
        if (!cancelled) setMeta(m);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  const kind = meta?.kind ?? presetKind ?? "file";
  const icon: IconName = KIND_ICON[kind] ?? "file";
  const glyphBg =
    KIND_GLYPH_BG[kind] ??
    "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)";

  const onOpen = () => {
    if (!artifactId) return;
    focusArtifact(artifactId);
  };

  if (!artifactId) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-3 text-[12px] text-text-muted">
        {t("missingId")}
      </div>
    );
  }

  if (error) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-left text-[12px] text-danger transition hover:border-danger/50"
      >
        <Icon name="alert-triangle" size={14} />
        <span className="flex-1 truncate">{t("loadFailed")}</span>
        <Icon name="external-link" size={12} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-soft-sm transition-all duration-fast ease-out hover:-translate-y-px hover:border-border-strong hover:shadow-soft-md"
      title={t("openInPanel")}
    >
      <span
        aria-hidden="true"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white shadow-soft-sm"
        style={{ backgroundImage: glyphBg }}
      >
        <Icon name={icon} size={18} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold tracking-tight text-text">
            {meta?.name ?? t("loading")}
          </span>
          <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-primary-muted px-1.5 font-mono text-[10px] uppercase tracking-wider text-primary">
            {kind}
          </span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[10.5px] text-text-subtle">
          {meta
            ? `v${meta.version} · ${fmtSize(meta.size_bytes)} · ${t("clickToOpen")}`
            : t("loadingHint")}
        </div>
      </div>
      <span className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-muted transition group-hover:border-primary/40 group-hover:text-primary">
        {t("open")}
        <Icon name="external-link" size={10} />
      </span>
    </button>
  );
}
