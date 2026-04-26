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

// Glyph backgrounds live in app/globals.css as `--artifact-gradient-<kind>`
// CSS variables (E10 · raw hex banned in component files). Map a known
// kind to its var; unknowns fall back to the brand primary→accent gradient.
const KIND_GRADIENT_VAR: Record<string, string> = {
  pptx: "var(--artifact-gradient-pptx)",
  docx: "var(--artifact-gradient-docx)",
  pdf: "var(--artifact-gradient-pdf)",
  xlsx: "var(--artifact-gradient-xlsx)",
  csv: "var(--artifact-gradient-csv)",
  markdown: "var(--artifact-gradient-markdown)",
  code: "var(--artifact-gradient-code)",
  drawio: "var(--artifact-gradient-drawio)",
  mermaid: "var(--artifact-gradient-mermaid)",
  html: "var(--artifact-gradient-html)",
  data: "var(--artifact-gradient-data)",
  image: "var(--artifact-gradient-image)",
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
  const glyphBg = KIND_GRADIENT_VAR[kind] ?? "var(--artifact-gradient-default)";

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
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-soft-sm transition-[transform,border-color,box-shadow] duration-fast ease-out hover:-translate-y-px hover:border-border-strong hover:shadow-soft-md"
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
