"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const EMBED_URL = "https://embed.diagrams.net/?embed=1&proto=json&spin=1&ui=atlas&saveAndExit=0";

export function DrawioView({
  content,
  height = 480,
  editable = false,
}: {
  content: string;
  height?: number;
  editable?: boolean;
}) {
  const t = useTranslations("artifacts.drawio");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (!iframeRef.current || ev.source !== iframeRef.current.contentWindow) return;
      let data: { event?: string } | null = null;
      try {
        data = typeof ev.data === "string" ? JSON.parse(ev.data) : null;
      } catch {
        return;
      }
      if (!data) return;
      if (data.event === "init") {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({
            action: "load",
            xml: content,
            autosave: 0,
            modified: "unsaved",
          }),
          "*",
        );
        setReady(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [content]);

  return (
    <div className="relative">
      <iframe
        ref={iframeRef}
        title={t("title")}
        src={editable ? EMBED_URL : `${EMBED_URL}&chrome=0`}
        sandbox="allow-scripts allow-same-origin allow-popups"
        className="w-full border-0 bg-surface"
        style={{ height }}
      />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-text-muted">
          {t("loading")}
        </div>
      )}
    </div>
  );
}
