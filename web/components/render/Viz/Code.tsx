"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { RenderProps } from "@/lib/component-registry";
import { Icon } from "@/components/ui/icon";
import { CopyButton } from "@/components/render/_shared/CopyButton";

/**
 * Brand-Blue V2 (ADR 0016) · code block.
 *
 * Interactions (2026-04-25):
 *   - line-wrap toggle  · long lines no longer force horizontal scroll
 *   - copy              · standardised on shared CopyButton
 *   - line numbers      · always on
 *   - highlight lines   · driven by props.highlightLines
 */
export function Code({ props, interactions }: RenderProps) {
  const t = useTranslations("viz.code");
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
          <button
            type="button"
            onClick={() => setWrap((v) => !v)}
            aria-pressed={wrap}
            title={wrap ? t("wrapOff") : t("wrapOn")}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-fast ${
              wrap
                ? "bg-primary-muted text-primary"
                : "text-text-muted hover:bg-surface hover:text-text"
            }`}
          >
            <Icon name="list" size={12} />
          </button>
          <CopyButton value={copyText} label={t("copyLabel")} />
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
