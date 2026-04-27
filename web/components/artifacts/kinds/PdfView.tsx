"use client";

import { useTranslations } from "next-intl";

/**
 * PdfView · embed the artifact's binary content via the browser's native
 * PDF viewer. Far simpler + higher fidelity than any JS pdf renderer; the
 * trade-off is users stuck on browsers that don't ship a viewer (Firefox
 * Mobile pre-2019, some embedded webviews) get a download prompt instead.
 *
 * Source URL points at the artifact-content REST endpoint so the browser
 * caches per-id and we don't have to base64-encode bytes through React.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export function PdfView({ artifactId, height = 720 }: { artifactId: string; height?: number }) {
  const t = useTranslations("artifacts.pdf");
  return (
    <iframe
      src={`${BASE}/api/artifacts/${artifactId}/content`}
      title={t("iframeTitle")}
      className="w-full border-0 bg-surface"
      style={{ height }}
    />
  );
}
