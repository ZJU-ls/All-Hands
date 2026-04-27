"use client";

/**
 * Artifact.Preview · render target that inlines an artifact in chat.
 *
 * V2-level (ADR 0016): `rounded-xl border bg-surface shadow-soft-sm` card
 * with a gradient icon tile keyed by kind, a title + kind/version chip
 * header, and a per-kind body renderer.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/ui/icon";
import type { RenderProps } from "@/lib/component-registry";
import { useArtifactFocus } from "@/lib/artifact-focus-store";
import {
  getArtifact,
  getArtifactTextContent,
  isBinaryKind,
  type ArtifactDto,
  type ArtifactKind,
} from "@/lib/artifacts-api";
import { MarkdownView } from "@/components/artifacts/kinds/MarkdownView";
import { CodeView } from "@/components/artifacts/kinds/CodeView";
import { HtmlView } from "@/components/artifacts/kinds/HtmlView";
import { ImageView } from "@/components/artifacts/kinds/ImageView";
import { DataView } from "@/components/artifacts/kinds/DataView";
import { MermaidView } from "@/components/artifacts/kinds/MermaidView";
import { DrawioView } from "@/components/artifacts/kinds/DrawioView";
import { PdfView } from "@/components/artifacts/kinds/PdfView";
import { CsvView } from "@/components/artifacts/kinds/CsvView";
import { XlsxView } from "@/components/artifacts/kinds/XlsxView";
import { DocxView } from "@/components/artifacts/kinds/DocxView";
import { PptxView } from "@/components/artifacts/kinds/PptxView";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

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
  video: "play-circle",
};

function kindIcon(kind: string): IconName {
  return KIND_ICON[kind] ?? "file";
}

function StatusShell({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "muted" | "danger" | "loading";
}) {
  const ring =
    tone === "danger"
      ? "border-danger/40 bg-danger-soft text-danger"
      : tone === "loading"
        ? "border-dashed border-border bg-surface-2 text-text-muted"
        : "border-dashed border-border bg-surface text-text-muted";
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-[12px] shadow-soft-sm ${ring}`}
    >
      {children}
    </div>
  );
}

export function ArtifactPreview({ props }: RenderProps) {
  const t = useTranslations("render.preview");
  const artifactId = (props.artifact_id as string | undefined) ?? "";
  const focusArtifact = useArtifactFocus((s) => s.focus);
  const [meta, setMeta] = useState<ArtifactDto | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!artifactId) return;
    let cancelled = false;

    async function run() {
      try {
        const m = await getArtifact(artifactId);
        if (cancelled) return;
        setMeta(m);
        if (!isBinaryKind(m.kind)) {
          const t = await getArtifactTextContent(m.id);
          if (!cancelled) setText(t);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  if (!artifactId) {
    return (
      <StatusShell tone="muted">
        <Icon name="alert-circle" size={14} />
        {t("missingId")}
      </StatusShell>
    );
  }
  if (error) {
    return (
      <StatusShell tone="danger">
        <Icon name="alert-triangle" size={14} />
        {t("loadFailed", { error })}
      </StatusShell>
    );
  }
  if (!meta) {
    return (
      <StatusShell tone="loading">
        <Icon name="loader" size={14} className="animate-spin-slow" />
        {t("loading")}
      </StatusShell>
    );
  }

  const icon = kindIcon(meta.kind as ArtifactKind);
  let body: React.ReactNode = null;
  if (meta.kind === "image") {
    body = <ImageView src={`${BASE}/api/artifacts/${meta.id}/content`} alt={meta.name} />;
  } else if (meta.kind === "pdf") {
    body = <PdfView artifactId={meta.id} height={520} />;
  } else if (meta.kind === "xlsx") {
    body = <XlsxView artifactId={meta.id} />;
  } else if (meta.kind === "docx") {
    body = <DocxView artifactId={meta.id} />;
  } else if (meta.kind === "pptx") {
    body = <PptxView artifactId={meta.id} artifactName={meta.name} />;
  } else if (text != null) {
    const mime = meta.mime_type;
    const language = mime.startsWith("text/") ? mime.slice(5).split(";")[0]?.trim() : undefined;
    switch (meta.kind) {
      case "markdown":
        body = <MarkdownView content={text} />;
        break;
      case "code":
        body = <CodeView content={text} language={language} />;
        break;
      case "html":
        body = <HtmlView content={text} />;
        break;
      case "data":
        body = <DataView content={text} />;
        break;
      case "mermaid":
        body = <MermaidView content={text} />;
        break;
      case "drawio":
        // Chat-side preview: 480px fits a typical message rhythm + the
        // diagram auto-fits the iframe (fit=1&zoom=auto + postMessage
        // 'fit' from DrawioView). Container width is whatever the
        // message column gives — diagrams.net scales content.
        body = <DrawioView content={text} height={480} />;
        break;
      case "csv":
        body = <CsvView content={text} />;
        break;
      default:
        body = (
          <div className="px-5 py-4 text-[12px] text-text-muted">
            {t("unsupportedKind", { kind: meta.kind })}
          </div>
        );
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-soft-sm">
      <div className="flex items-center gap-3 border-b border-border bg-surface-2/60 px-4 py-3">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-primary-fg shadow-soft-sm"
          style={{
            backgroundImage:
              "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)",
          }}
        >
          <Icon name={icon} size={16} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold tracking-tight text-text">
            {meta.name}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-text-subtle">
            v{meta.version}
          </div>
        </div>
        <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-primary-muted px-2 font-mono text-[10px] uppercase tracking-wider text-primary">
          {meta.kind}
        </span>
        <PreviewQuickActions
          meta={meta}
          text={text}
          onFocusPanel={() => focusArtifact(meta.id)}
        />
      </div>
      {body}
    </div>
  );
}

/**
 * Compact quick-action strip on the chat-side preview header.
 *
 * Mirrors the toolbar buttons in `ArtifactDetail` so the user can act on the
 * artifact without first opening the panel:
 *   - 在新窗口打开 (HTML / image / data — kinds whose raw bytes are
 *     directly viewable in a browser tab)
 *   - 下载 (every kind — calls /content?download=true)
 *   - 复制内容 (text kinds — drops content to clipboard)
 *   - 在制品面板打开 (always — focus + open the right drawer)
 *
 * Each button is icon-only with `title=` tooltips to keep the header tight.
 */
function PreviewQuickActions({
  meta,
  text,
  onFocusPanel,
}: {
  meta: ArtifactDto;
  text: string | null;
  onFocusPanel: () => void;
}) {
  const t = useTranslations("render.preview");
  const [copied, setCopied] = useState(false);

  const contentUrl = `${BASE}/api/artifacts/${meta.id}/content`;
  const downloadUrl = `${contentUrl}?download=true`;
  const canOpenInTab = ["html", "image", "data", "pdf"].includes(meta.kind);
  const canCopy = !isBinaryKind(meta.kind) && text != null;

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard rejected (insecure context) — degrade silently
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      {canOpenInTab && (
        <a
          href={contentUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={t("openInNewTab")}
          title={t("openInNewTab")}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition hover:border-primary/40 hover:text-primary"
        >
          <Icon name="external-link" size={11} />
        </a>
      )}
      {canCopy && (
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label={copied ? t("copied") : t("copy")}
          title={copied ? t("copied") : t("copy")}
          className={
            "inline-flex h-6 w-6 items-center justify-center rounded-md border bg-surface transition " +
            (copied
              ? "border-success/40 text-success"
              : "border-border text-text-muted hover:border-primary/40 hover:text-primary")
          }
        >
          <Icon name={copied ? "check" : "copy"} size={11} />
        </button>
      )}
      <a
        href={downloadUrl}
        aria-label={t("download")}
        title={t("download")}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition hover:border-primary/40 hover:text-primary"
      >
        <Icon name="download" size={11} />
      </a>
      <button
        type="button"
        onClick={onFocusPanel}
        aria-label={t("openInPanel")}
        title={t("openInPanel")}
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2 font-mono text-[10px] text-text-muted transition hover:border-primary/40 hover:text-primary"
      >
        <Icon name="folder" size={11} />
        {t("open")}
      </button>
    </div>
  );
}
