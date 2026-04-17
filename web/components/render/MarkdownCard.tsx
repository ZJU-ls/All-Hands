"use client";

import { useEffect, useRef } from "react";
import type { RenderProps } from "@/lib/component-registry";

export function MarkdownCard({ props, interactions }: RenderProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const content = (props.content as string) ?? "";
  const title = (props.title as string) ?? "";

  useEffect(() => {
    async function renderMarkdown() {
      if (!contentRef.current) return;
      const { marked } = await import("marked");
      const html = await marked.parse(content, { breaks: true });
      if (contentRef.current) {
        contentRef.current.innerHTML = html;
      }
    }
    void renderMarkdown();
  }, [content]);

  const copyAction = interactions.find((i) => i.action === "copy_to_clipboard");

  return (
    <div className="rounded-lg border border-border bg-bg overflow-hidden">
      {(title || copyAction) && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          {title && (
            <span className="text-xs font-semibold text-text-muted">{title}</span>
          )}
          {copyAction && (
            <button
              className="text-xs text-text-muted hover:text-text transition-colors"
              onClick={() => {
                const text = (copyAction.payload?.text as string) ?? content;
                navigator.clipboard.writeText(text).catch(console.error);
              }}
            >
              Copy
            </button>
          )}
        </div>
      )}
      <div
        ref={contentRef}
        className="px-4 py-3 prose prose-invert prose-sm max-w-none"
      />
    </div>
  );
}
