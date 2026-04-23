"use client";

/**
 * MarkdownCard · render target for markdown-body tool results.
 *
 * V2-level (ADR 0016): `rounded-xl border border-border bg-surface
 * shadow-soft-sm` shell · optional header with leading book-open icon tile +
 * title + Copy action · body renders markdown through `marked` (prose).
 */

import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/icon";
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
  const hasHeader = Boolean(title) || Boolean(copyAction);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-soft-sm">
      {hasHeader && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2.5">
          {title && (
            <span className="grid h-6 w-6 place-items-center rounded-md bg-primary-muted text-primary">
              <Icon name="book-open" size={14} />
            </span>
          )}
          {title && (
            <span className="text-[13px] font-semibold tracking-tight text-text">
              {title}
            </span>
          )}
          {copyAction && (
            <button
              type="button"
              className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[11px] text-text-muted transition-colors duration-fast ease-out hover:border-border-strong hover:text-text"
              onClick={() => {
                const text = (copyAction.payload?.text as string) ?? content;
                navigator.clipboard.writeText(text).catch(console.error);
              }}
            >
              <Icon name="copy" size={12} />
              Copy
            </button>
          )}
        </div>
      )}
      <div
        ref={contentRef}
        className="prose prose-invert prose-sm max-w-none px-5 py-4"
      />
    </div>
  );
}
