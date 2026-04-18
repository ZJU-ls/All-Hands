"use client";

import type { RenderProps } from "@/lib/component-registry";

export function Code({ props, interactions }: RenderProps) {
  const code = (props.code as string | undefined) ?? "";
  const language = (props.language as string | undefined) ?? "";
  const filename = props.filename as string | undefined;
  const highlightLines = (props.highlightLines as number[] | undefined) ?? [];

  const lines = code.replace(/\n$/, "").split("\n");
  const copyAction = interactions.find((i) => i.action === "copy_to_clipboard");
  const lineNumWidth = String(lines.length).length;

  return (
    <div className="rounded-lg border border-border bg-bg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          {filename && (
            <span className="text-xs font-mono text-text truncate">
              {filename}
            </span>
          )}
          {language && (
            <span className="text-xs font-mono text-text-muted">{language}</span>
          )}
        </div>
        {copyAction && (
          <button
            className="text-xs text-text-muted hover:text-text transition-colors"
            onClick={() => {
              navigator.clipboard
                .writeText((copyAction.payload?.text as string) ?? code)
                .catch(() => {});
            }}
          >
            Copy
          </button>
        )}
      </div>
      <pre className="overflow-x-auto text-xs font-mono leading-relaxed py-2">
        <code className="block">
          {lines.map((line, i) => {
            const num = i + 1;
            const highlighted = highlightLines.includes(num);
            return (
              <span
                key={i}
                className={`flex ${highlighted ? "bg-primary/10" : ""}`}
              >
                <span
                  className="select-none pl-3 pr-3 text-text-subtle text-right"
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
