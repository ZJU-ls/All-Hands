"use client";

/**
 * DocxView · fetch the .docx blob, render to HTML in-place via docx-preview.
 * Pure client-side · no server roundtrip beyond the original /content fetch.
 *
 * docx-preview can't handle every Word feature (complex SmartArt, embedded
 * Excel, custom XML parts), so we wrap the render call in try/catch and
 * fall back to a 「下载查看」 message — same UX as pptx.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

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
        const blob = await res.blob();
        const dp = await import("docx-preview");
        if (cancelled || !containerRef.current) return;
        await dp.renderAsync(blob, containerRef.current, undefined, {
          // light theme for now · token-based dark mode for office docs needs
          // a docx-preview style override pass we'll do in v1
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
    return (
      <div className="px-4 py-3 text-[12px] text-danger">
        {t("loadFailed", { error })}
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
