"use client";

import type { RenderProps } from "@/lib/component-registry";

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
    <div
      className="rounded-lg border border-border bg-surface overflow-hidden transition-colors duration-base hover:border-border-strong"
      style={{ animation: "ah-fade-up var(--dur-mid) var(--ease-out)" }}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* macOS-style traffic-light tip that this is a code panel, done
              in 3 semantic dots — doesn't count as new colors, reuses
              warning/danger/success tokens that already exist. */}
          <span className="hidden sm:flex items-center gap-1 mr-1">
            <span className="h-2 w-2 rounded-full bg-danger/60" aria-hidden />
            <span className="h-2 w-2 rounded-full bg-warning/60" aria-hidden />
            <span className="h-2 w-2 rounded-full bg-success/60" aria-hidden />
          </span>
          {filename && (
            <span className="text-xs font-mono text-text truncate">
              {filename}
            </span>
          )}
          {language && (
            <span className="text-[10px] font-mono text-text-subtle uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface border border-border">
              {language}
            </span>
          )}
        </div>
        {copyAction && (
          <button
            className="text-[11px] font-mono text-text-muted hover:text-primary transition-colors duration-fast"
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
                className={`flex border-l-2 transition-colors duration-fast ${
                  highlighted
                    ? "border-primary bg-primary-soft"
                    : "border-transparent hover:bg-surface-hover"
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
