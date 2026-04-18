"use client";

import { useEffect, useRef } from "react";

export function MarkdownView({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const { marked } = await import("marked");
      const html = await marked.parse(content, { breaks: true });
      if (!cancelled && ref.current) ref.current.innerHTML = html;
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [content]);
  return (
    <div
      ref={ref}
      className="prose prose-invert prose-sm max-w-none px-4 py-3 text-text"
    />
  );
}
