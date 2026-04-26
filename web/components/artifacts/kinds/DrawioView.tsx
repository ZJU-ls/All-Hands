"use client";

/**
 * DrawioView · embed diagrams.net iframe.
 *
 * - editable=false (default): full-screen viewer, no chrome
 * - editable=true: chrome on, save events round-trip through updateArtifact
 *
 * The save flow:
 *   iframe → {event: "save", xml, exit}
 *     → POST /api/artifacts/{id} with {content: xml}
 *     → server bumps version + emits SSE artifact_changed
 *     → ArtifactPanel auto-refreshes via existing handler
 *
 * Uses diagrams.net embed protocol:
 *   https://www.drawio.com/doc/faq/embed-mode
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { updateArtifact } from "@/lib/artifacts-api";

// Edit mode uses the full editor at embed.diagrams.net.
// View mode uses viewer.diagrams.net which is purpose-built for read-only
// embedding — no editor chrome, content fills the iframe naturally.
const EMBED_EDIT_BASE =
  "https://embed.diagrams.net/?embed=1&proto=json&spin=1&ui=atlas&saveAndExit=0";
const EMBED_VIEW_BASE = "https://viewer.diagrams.net/?embed=1&proto=json";

export function DrawioView({
  content,
  height = 480,
  editable = false,
  artifactId,
  fillHeight = false,
}: {
  content: string;
  height?: number;
  /** When true, allow editing + auto-save to server. Requires artifactId. */
  editable?: boolean;
  /** Required when editable=true so save can call PATCH. */
  artifactId?: string;
  /**
   * When true, iframe stretches to fill the parent container height instead
   * of using fixed `height`. Use in artifact detail panel where vertical
   * real estate is meaningful; chat-side preview keeps fixed height for
   * consistent message rhythm.
   */
  fillHeight?: boolean;
}) {
  const t = useTranslations("artifacts.drawio");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Keep latest content in a ref so the message handler doesn't re-bind on
  // every prop change — we only want to load once per init.
  const contentRef = useRef(content);
  contentRef.current = content;

  const persist = useCallback(
    async (xml: string) => {
      if (!editable || !artifactId) return;
      setSaveStatus("saving");
      setErrorMsg(null);
      try {
        await updateArtifact(artifactId, { content: xml, mode: "overwrite" });
        setSaveStatus("ok");
        setTimeout(() => setSaveStatus("idle"), 1800);
      } catch (e) {
        setSaveStatus("error");
        setErrorMsg(String(e));
      }
    },
    [editable, artifactId],
  );

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (!iframeRef.current || ev.source !== iframeRef.current.contentWindow) return;
      let data: { event?: string; xml?: string } | null = null;
      try {
        data = typeof ev.data === "string" ? JSON.parse(ev.data) : null;
      } catch {
        return;
      }
      if (!data) return;

      if (data.event === "init") {
        const win = iframeRef.current?.contentWindow;
        win?.postMessage(
          JSON.stringify({
            action: "load",
            xml: contentRef.current,
            // autosave fires the save event without a save button click
            autosave: editable ? 1 : 0,
            modified: "unsaved",
          }),
          "*",
        );
        // Fit-to-page is now driven by the URL params `&fit=1&zoom=auto&nav=0`
        // (see `src` below). An earlier version postMessaged
        // `{action:"prompt",reset:true}` to "graceful no-op trigger" a fit —
        // turns out `prompt` actually opens drawio's prompt dialog (the
        // 「文件名: __ undefined」 popup users hit). Don't do that.
        setReady(true);
      } else if (data.event === "save" && typeof data.xml === "string") {
        void persist(data.xml);
      } else if (data.event === "autosave" && typeof data.xml === "string") {
        void persist(data.xml);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [editable, persist]);

  // View mode (viewer.diagrams.net) URL params:
  // - lightbox=1        read-only lightbox-style embed; content auto-fits
  //                      iframe and the bottom zoom/print/camera toolbar is
  //                      driven by `toolbar=`
  // - toolbar=          empty value → no viewer toolbar (hides the
  //                      noisy 「放大/缩小/适配/打印/相机」 strip the user flagged)
  // - nav=0             no page navigation arrows
  // - highlight=0       no edge highlighting on hover
  // - max-fit-scale=4   let fit scale up past 100% so narrow diagrams
  //                      actually fill the iframe (was leaving big gutters)
  // - page=0            hide the white page boundary; content extends to
  //                      fill the iframe instead of sitting on a centered page
  const src = editable
    ? `${EMBED_EDIT_BASE}&fit=1&max-fit-scale=4`
    : `${EMBED_VIEW_BASE}&lightbox=1&toolbar=&nav=0&highlight=0&max-fit-scale=4&page=0&fit=1&zoom=auto`;

  const wrapperStyle = fillHeight
    ? { height: "100%" }
    : { height: `${height}px` };
  const iframeStyle = fillHeight ? { height: "100%" } : { height: `${height}px` };

  return (
    <div className="relative" style={wrapperStyle}>
      <iframe
        ref={iframeRef}
        title={t("title")}
        src={src}
        sandbox="allow-scripts allow-same-origin allow-popups"
        className="block w-full border-0 bg-surface"
        style={iframeStyle}
      />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-text-muted">
          {t("loading")}
        </div>
      )}
      {editable && saveStatus !== "idle" && (
        <div
          className={
            "absolute right-3 top-3 rounded-full border px-2.5 py-1 font-mono text-[10px] " +
            (saveStatus === "saving"
              ? "border-primary/40 bg-primary-muted text-primary"
              : saveStatus === "ok"
                ? "border-success/40 bg-success-soft text-success"
                : "border-danger/40 bg-danger-soft text-danger")
          }
          title={errorMsg ?? undefined}
        >
          {saveStatus === "saving" && t("saving")}
          {saveStatus === "ok" && t("saved")}
          {saveStatus === "error" && t("saveFailed")}
        </div>
      )}
    </div>
  );
}
