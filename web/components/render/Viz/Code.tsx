"use client";

import { useState } from "react";
import type { RenderProps } from "@/lib/component-registry";
import { Icon } from "@/components/ui/icon";
import { CopyButton } from "@/components/render/_shared/CopyButton";

// Lines longer than this risk needing horizontal scroll in a chat-embedded
// preview. Below the threshold, the wrap toggle is a no-op visually, so we
// hide it altogether — a button you can press without seeing any change is
// strictly worse than no button.
const WRAP_THRESHOLD_CHARS = 80;

/**
 * Brand-Blue V2 (ADR 0016) · code block.
 *
 * Interactions (2026-04-25):
 *   - line-wrap toggle  · only renders when at least one line exceeds
 *                         WRAP_THRESHOLD_CHARS; otherwise the button
 *                         would be a no-op + an unclear icon
 *   - copy              · standardised on shared CopyButton
 *   - line numbers      · always on
 *   - highlight lines   · driven by props.highlightLines
 */
export function Code({ props, interactions }: RenderProps) {
  const code = typeof props.code === "string" ? props.code : "";
  const language = typeof props.language === "string" ? props.language : "";
  const filename = typeof props.filename === "string" ? props.filename : undefined;
  const highlightLines = Array.isArray(props.highlightLines)
    ? (props.highlightLines as number[])
    : [];

  const [wrap, setWrap] = useState(false);

  const lines = code.replace(/\n$/, "").split("\n");
  const safeInteractions = Array.isArray(interactions) ? interactions : [];
  const copyAction = safeInteractions.find((i) => i.action === "copy_to_clipboard");
  const copyText = (copyAction?.payload?.text as string | undefined) ?? code;
  const lineNumWidth = String(lines.length).length;
  const hasLongLine = lines.some((l) => l.length > WRAP_THRESHOLD_CHARS);

  return (
    <div className="rounded-xl border border-border bg-surface-2 overflow-hidden shadow-soft-sm animate-fade-up">
      <div className="flex items-center gap-2 border-b border-border bg-surface-3/40 px-3 py-2">
        {filename && (
          <span className="truncate text-caption font-mono text-text">
            {filename}
          </span>
        )}
        {language && (
          <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-caption font-mono uppercase tracking-wider text-text-muted">
            {language}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {hasLongLine ? (
            <button
              type="button"
              onClick={() => setWrap((v) => !v)}
              aria-pressed={wrap}
              title={wrap ? "关闭自动换行" : "开启自动换行 · 长行不再水平滚动"}
              className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 text-caption transition-colors duration-fast ${
                wrap
                  ? "border-primary/40 bg-primary-muted text-primary"
                  : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text"
              }`}
            >
              <Icon name="list" size={11} />
              <span>{wrap ? "已换行" : "换行"}</span>
            </button>
          ) : null}
          <CopyButton value={copyText} label="复制代码" />
        </div>
      </div>
      <pre className={`overflow-x-auto py-3 text-caption font-mono leading-relaxed ${wrap ? "whitespace-pre-wrap" : ""}`}>
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
                  className="select-none pl-3 pr-3 text-right tabular-nums text-text-subtle"
                  style={{ minWidth: `${lineNumWidth + 2}ch` }}
                >
                  {num}
                </span>
                <span
                  className={`pr-3 text-text ${wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}
                >
                  {line || " "}
                </span>
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
