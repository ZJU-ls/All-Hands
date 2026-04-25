"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getArtifact,
  getArtifactTextContent,
  getArtifactVersionContent,
  isBinaryKind,
  listArtifactVersions,
  type ArtifactContentDto,
  type ArtifactDto,
  type ArtifactVersionDto,
} from "@/lib/artifacts-api";
import { MarkdownView } from "./kinds/MarkdownView";
import { CodeView } from "./kinds/CodeView";
import { HtmlView } from "./kinds/HtmlView";
import { ImageView } from "./kinds/ImageView";
import { DataView } from "./kinds/DataView";
import { MermaidView } from "./kinds/MermaidView";
import { ArtifactVersionSwitcher } from "./ArtifactVersionSwitcher";

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

export function ArtifactDetail({ artifactId }: { artifactId: string }) {
  const t = useTranslations("artifacts.detail");
  const [meta, setMeta] = useState<ArtifactDto | null>(null);
  const [versions, setVersions] = useState<ArtifactVersionDto[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [content, setContent] = useState<LoadedContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setVersions([]);
    setCurrentVersion(null);
    setContent(null);
    setError(null);

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

  if (error) {
    return (
      <div className="px-4 py-3 text-[12px] text-danger">{t("loadFailed", { error })}</div>
    );
  }
  if (!meta) {
    return <div className="px-4 py-3 text-[12px] text-text-muted">{t("loadingMeta")}</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-text">{meta.name}</div>
          <div className="truncate font-mono text-[10px] text-text-subtle">
            {meta.kind} · v{meta.version} · {meta.mime_type} · {meta.size_bytes} B
          </div>
        </div>
        <a
          href={`${BASE}/api/artifacts/${meta.id}/content?download=true`}
          className="inline-flex h-7 items-center rounded-md border border-border px-3 text-[11px] text-text-muted transition-colors duration-base hover:text-text hover:border-border-strong"
        >
          {t("download")}
        </a>
      </div>
      <ArtifactVersionSwitcher
        versions={versions}
        current={currentVersion ?? meta.version}
        onSelect={(v) => setCurrentVersion(v)}
      />
      <div className="flex-1 overflow-y-auto">
        {content ? renderBody(meta, content, t("unsupportedKind", { kind: meta.kind })) : (
          <div className="px-4 py-3 text-[12px] text-text-muted">{t("loadingContent")}</div>
        )}
      </div>
    </div>
  );
}
