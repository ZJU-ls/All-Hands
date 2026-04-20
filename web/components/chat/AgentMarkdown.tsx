"use client";

import { useEffect, useRef } from "react";

/**
 * Shared markdown renderer for agent (assistant / model) outputs across chat
 * surfaces — MessageBubble, ModelTestDialog, anywhere a model streams prose.
 *
 * Dynamic-imports `marked` like MarkdownView does so the parser stays out of
 * the initial bundle. Parent controls the surrounding padding — this renderer
 * only owns typography (prose classes).
 *
 * User-authored text should NOT go through this: users type literal strings
 * and expect whitespace-pre-wrap, not markdown semantics.
 */
export function AgentMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
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
      data-testid="agent-markdown"
      className={
        className ??
        "prose prose-invert prose-sm max-w-none text-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      }
    />
  );
}
