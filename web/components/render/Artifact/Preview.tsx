"use client";

import { useEffect, useState } from "react";
import type { RenderProps } from "@/lib/component-registry";
import {
  getArtifact,
  getArtifactTextContent,
  isBinaryKind,
  type ArtifactDto,
} from "@/lib/artifacts-api";
import { MarkdownView } from "@/components/artifacts/kinds/MarkdownView";
import { CodeView } from "@/components/artifacts/kinds/CodeView";
import { HtmlView } from "@/components/artifacts/kinds/HtmlView";
import { ImageView } from "@/components/artifacts/kinds/ImageView";
import { DataView } from "@/components/artifacts/kinds/DataView";
import { MermaidView } from "@/components/artifacts/kinds/MermaidView";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export function ArtifactPreview({ props }: RenderProps) {
  const artifactId = (props.artifact_id as string | undefined) ?? "";
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
      <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-text-muted">
        Artifact.Preview 缺少 artifact_id
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-border px-3 py-2 text-xs text-danger">
        制品加载失败:{error}
      </div>
    );
  }
  if (!meta) {
    return (
      <div className="rounded-lg border border-border px-3 py-2 text-xs text-text-muted">
        读取制品…
      </div>
    );
  }

  let body: React.ReactNode = null;
  if (meta.kind === "image") {
    body = <ImageView src={`${BASE}/api/artifacts/${meta.id}/content`} alt={meta.name} />;
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
      default:
        body = (
          <div className="px-4 py-3 text-xs text-text-muted">
            kind {meta.kind} 暂不支持预览
          </div>
        );
    }
  }

  return (
    <div className="rounded-lg border border-border bg-bg overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-text">{meta.name}</div>
          <div className="truncate font-mono text-[10px] text-text-subtle">
            {meta.kind} · v{meta.version}
          </div>
        </div>
        <span className="font-mono text-[10px] text-text-muted">制品</span>
      </div>
      {body}
    </div>
  );
}
