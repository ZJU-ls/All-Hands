"use client";

/**
 * DocxView · fetch the .docx, render to HTML in-place via docx-preview.
 *
 * Implementation notes:
 * - We pull bytes as `ArrayBuffer` not `Blob`. fetch().blob() carries an
 *   inferred MIME type that some docx-preview versions misuse during zip
 *   unpacking, surfacing as 「Bug : uncompressed data size mismatch」 even
 *   when the .docx is a perfectly valid zip (verified via `unzip -l`).
 *   ArrayBuffer skips that path.
 * - When docx-preview throws anyway (truly unsupported features — embedded
 *   Excel, complex SmartArt, custom XML parts), we fall back to a
 *   download-prompting UI so the user still has a path to the content.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export function DocxView({ artifactId }: { artifactId: string }) {
  const t = useTranslations("artifacts.docx");
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${BASE}/api/artifacts/${artifactId}/content`);
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        // ArrayBuffer over Blob — see file-level note. Wrapping in a Blob
        // with the explicit OOXML mime keeps docx-preview's internal type
        // dispatch happy.
        const buf = await res.arrayBuffer();
        const blob = new Blob([buf], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        const dp = await import("docx-preview");
        if (cancelled || !containerRef.current) return;
        await dp.renderAsync(blob, containerRef.current, undefined, {
          inWrapper: true,
          ignoreHeight: false,
          ignoreWidth: false,
          ignoreFonts: false,
        });
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  if (error) {
    // Friendly fallback: the .docx is on disk and downloadable, just not
    // renderable in-browser. Surface a download CTA instead of raw error
    // text — same UX pattern as pptx.
    const downloadUrl = `${BASE}/api/artifacts/${artifactId}/content?download=true`;
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-warning-soft text-warning">
          <Icon name="alert-circle" size={18} />
        </span>
        <div className="max-w-sm text-[12px] text-text-muted">
          {t("loadFailed", { error })}
        </div>
        <a
          href={downloadUrl}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary-soft px-3 text-[12px] font-medium text-primary transition hover:bg-primary/15"
        >
          <Icon name="download" size={12} />
          {t("downloadFallback")}
        </a>
      </div>
    );
  }
  return (
    <div className="overflow-auto bg-white" style={{ maxHeight: "70vh" }}>
      <div ref={containerRef} className="docx-preview-container p-4" />
      {!ready && (
        <div className="px-4 py-3 text-center text-[12px] text-text-muted">
          {t("loading")}
        </div>
      )}
    </div>
  );
}
