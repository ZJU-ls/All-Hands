"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getArtifact,
  getArtifactTextContent,
  getArtifactVersionContent,
  isBinaryKind,
  listArtifactVersions,
  rollbackArtifact,
  updateArtifact,
  type ArtifactContentDto,
  type ArtifactDto,
  type ArtifactVersionDto,
} from "@/lib/artifacts-api";
import { Icon } from "@/components/ui/icon";
import { MarkdownView } from "./kinds/MarkdownView";
import { CodeView } from "./kinds/CodeView";
import { HtmlView } from "./kinds/HtmlView";
import { ImageView } from "./kinds/ImageView";
import { DataView } from "./kinds/DataView";
import { MermaidView } from "./kinds/MermaidView";
import { ArtifactVersionSwitcher } from "./ArtifactVersionSwitcher";
import { ArtifactEditor, pickEditorLanguage } from "./ArtifactEditor";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

type LoadedContent =
  | { kind: "text"; content: string }
  | { kind: "base64"; mime: string; base64: string }
  | { kind: "binary-src"; src: string };

function extractLanguage(mime: string): string | undefined {
  if (!mime.startsWith("text/")) return undefined;
  const sub = mime.slice(5).split(";")[0]?.trim();
  return sub || undefined;
}

function contentFromDto(dto: ArtifactContentDto): LoadedContent {
  if (dto.content != null) return { kind: "text", content: dto.content };
  if (dto.content_base64 != null)
    return { kind: "base64", mime: dto.mime_type, base64: dto.content_base64 };
  return { kind: "text", content: "" };
}

function renderBody(
  artifact: ArtifactDto,
  loaded: LoadedContent,
  unsupportedMsg: string,
): React.ReactNode {
  switch (artifact.kind) {
    case "markdown":
      return loaded.kind === "text" ? <MarkdownView content={loaded.content} /> : null;
    case "code":
      return loaded.kind === "text" ? (
        <CodeView content={loaded.content} language={extractLanguage(artifact.mime_type)} />
      ) : null;
    case "html":
      return loaded.kind === "text" ? <HtmlView content={loaded.content} /> : null;
    case "data":
      return loaded.kind === "text" ? <DataView content={loaded.content} /> : null;
    case "mermaid":
      return loaded.kind === "text" ? <MermaidView content={loaded.content} /> : null;
    case "image": {
      const src =
        loaded.kind === "base64"
          ? `data:${loaded.mime};base64,${loaded.base64}`
          : loaded.kind === "binary-src"
            ? loaded.src
            : "";
      return <ImageView src={src} alt={artifact.name} />;
    }
    default:
      return (
        <div className="px-4 py-3 text-xs text-text-muted">
          {unsupportedMsg}
        </div>
      );
  }
}

type ToolbarMode = "view" | "edit";

export function ArtifactDetail({ artifactId }: { artifactId: string }) {
  const t = useTranslations("artifacts.detail");
  const [meta, setMeta] = useState<ArtifactDto | null>(null);
  const [versions, setVersions] = useState<ArtifactVersionDto[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [content, setContent] = useState<LoadedContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  // P1 · edit mode + transient toolbar feedback. Edit only makes sense
  // for text kinds; binary kinds hide the chip entirely. Saving the
  // edit calls PATCH /artifacts/{id}, which bumps version on the server
  // and SSE-pushes the change back so the panel auto-refreshes.
  const [mode, setMode] = useState<ToolbarMode>("view");
  const [draft, setDraft] = useState<string>("");
  const [busy, setBusy] = useState<null | "save" | "rollback">(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setVersions([]);
    setCurrentVersion(null);
    setContent(null);
    setError(null);
    setMode("view");

    async function run() {
      try {
        const [m, vs] = await Promise.all([
          getArtifact(artifactId),
          listArtifactVersions(artifactId),
        ]);
        if (cancelled) return;
        setMeta(m);
        setVersions(vs);
        setCurrentVersion(m.version);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  useEffect(() => {
    if (!meta || currentVersion == null) return;
    let cancelled = false;
    async function load() {
      try {
        if (!meta) return;
        if (currentVersion === meta.version) {
          if (isBinaryKind(meta.kind)) {
            if (!cancelled)
              setContent({ kind: "binary-src", src: `${BASE}/api/artifacts/${meta.id}/content` });
          } else {
            const text = await getArtifactTextContent(meta.id);
            if (!cancelled) setContent({ kind: "text", content: text });
          }
          return;
        }
        const dto = await getArtifactVersionContent(meta.id, currentVersion!);
        if (!cancelled) setContent(contentFromDto(dto));
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [meta, currentVersion]);

  const handleCopy = useCallback(async () => {
    if (!content || content.kind !== "text") return;
    try {
      await navigator.clipboard.writeText(content.content);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch (e) {
      setError(t("copyFailed", { error: String(e) }));
    }
  }, [content, t]);

  const handleStartEdit = useCallback(() => {
    if (!content || content.kind !== "text") return;
    setDraft(content.content);
    setMode("edit");
  }, [content]);

  const handleCancelEdit = useCallback(() => {
    setMode("view");
    setDraft("");
  }, []);

  const handleSave = useCallback(async () => {
    if (!meta) return;
    setBusy("save");
    setError(null);
    try {
      const next = await updateArtifact(meta.id, { content: draft });
      const nextVersions = await listArtifactVersions(meta.id);
      setMeta(next);
      setVersions(nextVersions);
      setCurrentVersion(next.version);
      setContent({ kind: "text", content: draft });
      setMode("view");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [meta, draft]);

  const handleRollback = useCallback(
    async (target: number) => {
      if (!meta) return;
      if (
        !window.confirm(t("rollbackConfirm", { target, next: meta.version + 1 }))
      ) {
        return;
      }
      setBusy("rollback");
      setError(null);
      try {
        const next = await rollbackArtifact(meta.id, target);
        const nextVersions = await listArtifactVersions(meta.id);
        setMeta(next);
        setVersions(nextVersions);
        setCurrentVersion(next.version);
        // Force re-fetch via the version effect by clearing local content
        setContent(null);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [meta, t],
  );

  if (error && !meta) {
    return (
      <div className="px-4 py-3 text-[12px] text-danger">{t("loadFailed", { error })}</div>
    );
  }
  if (!meta) {
    return <div className="px-4 py-3 text-[12px] text-text-muted">{t("loadingMeta")}</div>;
  }

  const isText = !isBinaryKind(meta.kind);
  const canCopy = isText && content?.kind === "text";
  const canEdit = isText && currentVersion === meta.version; // only on latest
  const canOpenNew = ["html", "image", "data"].includes(meta.kind);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header: name + meta */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-text">{meta.name}</div>
          <div className="truncate font-mono text-[10px] text-text-subtle">
            {meta.kind} · v{meta.version} · {meta.mime_type} · {meta.size_bytes} B
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5">
        {mode === "view" ? (
          <>
            {canCopy && (
              <ToolButton
                onClick={handleCopy}
                title={t("toolbarCopyTitle")}
                data-testid="artifact-copy"
                accent={copyState === "copied"}
              >
                <Icon name={copyState === "copied" ? "check" : "copy"} size={11} />
                {copyState === "copied" ? t("copied") : t("copy")}
              </ToolButton>
            )}
            {canEdit && (
              <ToolButton
                onClick={handleStartEdit}
                title={t("toolbarEditTitle")}
                data-testid="artifact-edit"
              >
                <Icon name="edit" size={11} />
                {t("edit")}
              </ToolButton>
            )}
            {canOpenNew && (
              <ToolButton
                as="a"
                href={`${BASE}/api/artifacts/${meta.id}/content`}
                target="_blank"
                rel="noreferrer"
                title={t("toolbarOpenNewTitle")}
                data-testid="artifact-open-new"
              >
                <Icon name="external-link" size={11} />
                {t("openNew")}
              </ToolButton>
            )}
            <div className="ml-auto" />
            <ToolButton
              as="a"
              href={`${BASE}/api/artifacts/${meta.id}/content?download=true`}
              accent
              title={t("toolbarDownloadTitle")}
              data-testid="artifact-download"
            >
              <Icon name="download" size={11} />
              {t("download")}
            </ToolButton>
          </>
        ) : (
          <>
            <span className="text-[11px] text-primary font-mono">{t("editMode")}</span>
            <span className="text-[10px] text-text-subtle font-mono">
              {t("editModeHint")}
            </span>
            <div className="ml-auto" />
            <ToolButton
              onClick={handleCancelEdit}
              disabled={busy != null}
              title={t("editCancelTitle")}
              data-testid="artifact-edit-cancel"
            >
              {t("cancel")}
            </ToolButton>
            <ToolButton
              onClick={() => void handleSave()}
              disabled={busy != null}
              accent
              title={t("editSaveTitle")}
              data-testid="artifact-edit-save"
            >
              <Icon name={busy === "save" ? "loader" : "check"} size={11}
                className={busy === "save" ? "animate-spin-slow" : ""} />
              {busy === "save" ? t("saving") : t("save")}
            </ToolButton>
          </>
        )}
      </div>

      {/* Version switcher with rollback affordance per row */}
      <ArtifactVersionSwitcher
        versions={versions}
        current={currentVersion ?? meta.version}
        onSelect={(v) => setCurrentVersion(v)}
        latestVersion={meta.version}
        onRollback={isText ? handleRollback : undefined}
        rollbackBusy={busy === "rollback"}
      />

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {error && (
          <div className="border-b border-danger/30 bg-danger/5 px-4 py-1.5 text-[11px] text-danger">
            {error}
          </div>
        )}
        {mode === "edit" && meta ? (
          <ArtifactEditor
            value={draft}
            onChange={setDraft}
            language={pickEditorLanguage(meta.kind, meta.mime_type)}
            onSubmit={() => void handleSave()}
            disabled={busy != null}
          />
        ) : content ? (
          <div className="h-full overflow-y-auto">
            {renderBody(meta, content, t("unsupportedKind", { kind: meta.kind }))}
          </div>
        ) : (
          <div className="px-4 py-3 text-[12px] text-text-muted">{t("loadingContent")}</div>
        )}
      </div>
    </div>
  );
}

type ToolButtonProps = {
  children: React.ReactNode;
  accent?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  as?: "button" | "a";
  href?: string;
  target?: string;
  rel?: string;
  "data-testid"?: string;
};

function ToolButton(props: ToolButtonProps) {
  const { children, accent, disabled, title, onClick, as = "button", href, target, rel, ...rest } = props;
  const cls =
    "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors duration-fast " +
    (accent
      ? "border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
      : "border border-border bg-surface text-text-muted hover:text-text hover:border-border-strong") +
    (disabled ? " opacity-50 pointer-events-none" : "");
  if (as === "a") {
    return (
      <a className={cls} href={href} target={target} rel={rel} title={title} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} title={title} {...rest}>
      {children}
    </button>
  );
}
