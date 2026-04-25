"use client";

/**
 * PptxView · text-only outline preview.
 *
 * No good open-source pure-JS pptx renderer exists at acceptable fidelity,
 * so we deliberately compromise:
 *   1. Fetch the .pptx blob
 *   2. Treat it as a zip (jszip)
 *   3. Read each ppt/slides/slideN.xml
 *   4. Pull out the <a:t> text nodes per slide → render as cards
 *
 * Users that need the real visual open it in PowerPoint / Keynote via the
 * Download button. The tradeoff is documented in
 * docs/specs/2026-04-25-artifact-kinds-roadmap.md § 2.5.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

type SlideOutline = {
  index: number;
  title: string;
  body: string[];
};

export function PptxView({
  artifactId,
  artifactName,
}: {
  artifactId: string;
  artifactName?: string;
}) {
  const t = useTranslations("artifacts.pptx");
  const [slides, setSlides] = useState<SlideOutline[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${BASE}/api/artifacts/${artifactId}/content`);
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const blob = await res.blob();
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(blob);
        // slide files are ppt/slides/slide1.xml, slide2.xml, ... and we
        // sort by the trailing integer to match presentation order.
        const slideFiles = Object.keys(zip.files)
          .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
          .sort((a, b) => {
            const aN = parseInt(/(\d+)\.xml$/.exec(a)?.[1] ?? "0", 10);
            const bN = parseInt(/(\d+)\.xml$/.exec(b)?.[1] ?? "0", 10);
            return aN - bN;
          });
        const out: SlideOutline[] = [];
        for (let i = 0; i < slideFiles.length; i++) {
          const name = slideFiles[i] ?? "";
          const xml = await zip.files[name]!.async("string");
          // <a:t>...</a:t> is the actual text-run content. Concatenate, then
          // split paragraphs by <a:p> boundaries upstream.
          // First grab paragraphs via <a:p> for ordering, then runs <a:t>.
          const paraTexts: string[] = [];
          const paragraphs = xml.split(/<a:p[\s>]/);
          for (const p of paragraphs.slice(1)) {
            const runs = Array.from(p.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).map(
              (m) => m[1] ?? "",
            );
            const merged = runs
              .join("")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .trim();
            if (merged) paraTexts.push(merged);
          }
          out.push({
            index: i + 1,
            title: paraTexts[0] ?? "",
            body: paraTexts.slice(1),
          });
        }
        if (!cancelled) setSlides(out);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  const downloadHref = `${BASE}/api/artifacts/${artifactId}/content?download=true`;

  if (error) {
    return (
      <div className="px-4 py-3 text-[12px] text-danger">
        {t("loadFailed", { error })}
      </div>
    );
  }
  if (!slides) {
    return <div className="px-4 py-3 text-[12px] text-text-muted">{t("loading")}</div>;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2/40 px-4 py-2.5">
        <span className="text-[12px] text-text-muted">
          {t("count", { n: slides.length })}
        </span>
        <a
          href={downloadHref}
          download={artifactName ?? "deck.pptx"}
          className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-2.5 py-1 font-mono text-[10px] text-text hover:border-primary hover:text-primary"
        >
          <Icon name="arrow-down" size={11} />
          {t("download")}
        </a>
      </div>
      {slides.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12px] text-text-muted">
          {t("empty")}
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-3" style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {slides.map((s) => (
            <div
              key={s.index}
              className="rounded-lg border border-border bg-surface px-4 py-3"
            >
              <div className="mb-1 flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-text-subtle">#{s.index}</span>
                <span className="text-[13px] font-semibold text-text">
                  {s.title || t("untitledSlide")}
                </span>
              </div>
              {s.body.length > 0 ? (
                <ul className="ml-4 list-disc space-y-0.5 text-[12px] text-text-muted">
                  {s.body.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
