"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export function MermaidView({ content }: { content: string }) {
  const t = useTranslations("artifacts.mermaid");
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const mod = await import("mermaid");
        const mermaid = mod.default;
        mermaid.initialize({ startOnLoad: false, theme: "dark" });
        const { svg } = await mermaid.render(
          `mmd-${Math.random().toString(36).slice(2, 8)}`,
          content,
        );
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [content]);

  if (error) {
    return (
      <div className="px-4 py-3 text-xs text-danger">
        {t("renderFailed", { error })}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className="flex items-center justify-center overflow-x-auto px-4 py-3"
    />
  );
}
