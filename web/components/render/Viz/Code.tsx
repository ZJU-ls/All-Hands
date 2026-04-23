"use client";

import type { RenderProps } from "@/lib/component-registry";
import { Icon } from "@/components/ui/icon";

/**
 * Brand-Blue V2 (ADR 0016) · code block.
 *
 * Shell: rounded-xl · bg-surface-2 · overflow-hidden
 * Header: bg-surface-3/40 · mono caption · optional title + copy icon button
 * Body: font-mono text-caption leading-relaxed
 */
export function Code({ props, interactions }: RenderProps) {
  const code = typeof props.code === "string" ? props.code : "";
  const language = typeof props.language === "string" ? props.language : "";
  const filename = typeof props.filename === "string" ? props.filename : undefined;
  const highlightLines = Array.isArray(props.highlightLines)
    ? (props.highlightLines as number[])
    : [];

  const lines = code.replace(/\n$/, "").split("\n");
  const safeInteractions = Array.isArray(interactions) ? interactions : [];
  const copyAction = safeInteractions.find((i) => i.action === "copy_to_clipboard");
  const lineNumWidth = String(lines.length).length;

  return (
    <div className="rounded-xl border border-border bg-surface-2 overflow-hidden shadow-soft-sm animate-fade-up">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-3/40">
        {filename && (
          <span className="text-caption font-mono text-text truncate">
            {filename}
          </span>
        )}
        {language && (
          <span className="text-caption font-mono text-text-muted uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface border border-border">
            {language}
          </span>
        )}
        {copyAction && (
          <button
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:text-primary hover:bg-surface"
            onClick={() => {
              navigator.clipboard
                .writeText((copyAction.payload?.text as string) ?? code)
                .catch(() => {});
            }}
            aria-label="Copy code"
          >
            <Icon name="copy" size={14} />
          </button>
        )}
      </div>
      <pre className="overflow-x-auto text-caption font-mono leading-relaxed py-3">
        <code className="block">
          {lines.map((line, i) => {
            const num = i + 1;
            const highlighted = highlightLines.includes(num);
            return (
              <span
                key={i}
                className={`flex border-l-2 transition-colors duration-fast ${
                  highlighted
                    ? "border-primary bg-primary-soft"
                    : "border-transparent hover:bg-surface-2"
                }`}
              >
                <span
                  className="select-none pl-3 pr-3 text-text-subtle text-right tabular-nums"
                  style={{ minWidth: `${lineNumWidth + 2}ch` }}
                >
                  {num}
                </span>
                <span className="pr-3 text-text whitespace-pre">{line || " "}</span>
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
