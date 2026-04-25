"use client";

import { useState } from "react";
import type { RenderProps } from "@/lib/component-registry";
import { Icon, type IconName } from "@/components/ui/icon";
import { CopyButton } from "@/components/render/_shared/CopyButton";

type Kind = "info" | "warn" | "success" | "error";

const TONE: Record<Kind, { bg: string; title: string; tile: string; icon: IconName }> = {
  info: {
    bg: "bg-primary-soft border-primary/30",
    title: "text-primary",
    tile: "bg-primary/15 text-primary",
    icon: "info",
  },
  warn: {
    bg: "bg-warning-soft border-warning/30",
    title: "text-warning",
    tile: "bg-warning/15 text-warning",
    icon: "alert-triangle",
  },
  success: {
    bg: "bg-success-soft border-success/30",
    title: "text-success",
    tile: "bg-success/15 text-success",
    icon: "check-circle-2",
  },
  error: {
    bg: "bg-danger-soft border-danger/30",
    title: "text-danger",
    tile: "bg-danger/15 text-danger",
    icon: "alert-circle",
  },
};

const KINDS: readonly Kind[] = ["info", "warn", "success", "error"] as const;

function normKind(raw: unknown): Kind {
  if (typeof raw === "string" && (KINDS as readonly string[]).includes(raw)) {
    return raw as Kind;
  }
  if (raw === "warning") return "warn";
  if (raw === "ok" || raw === "done") return "success";
  if (raw === "danger" || raw === "err") return "error";
  return "info";
}

/**
 * Brand-Blue V2 (ADR 0016) · tone-tinted callout.
 *
 * Interactions (2026-04-25):
 *   - dismiss   · session-only (re-renders restore visibility unless the
 *                 host stores the dismissed state)
 *   - copy body · hover-revealed when content is non-trivial (>20 chars)
 *
 * Dismiss is opt-in via `props.dismissable`. Default off so existing
 * agent outputs don't lose their callouts after a misclick.
 */
export function Callout({ props }: RenderProps) {
  const kind = normKind(props.kind);
  const title = typeof props.title === "string" ? props.title : undefined;
  const content = typeof props.content === "string" ? props.content : "";
  const dismissable = props.dismissable === true;
  const tone = TONE[kind];

  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const showCopy = content.trim().length > 20;

  return (
    <div
      className={`group relative flex gap-3 rounded-xl border px-4 py-3.5 animate-fade-up ${tone.bg}`}
    >
      <span
        aria-hidden
        className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone.tile}`}
      >
        <Icon name={tone.icon} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        {title && (
          <div
            className={`text-caption font-mono font-semibold uppercase tracking-wider mb-1 break-words ${tone.title}`}
          >
            {title}
          </div>
        )}
        <div className="text-sm text-text leading-[1.55] whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
      {(showCopy || dismissable) ? (
        <div className="ml-2 flex shrink-0 items-start gap-1 opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-within:opacity-100">
          {showCopy ? (
            <CopyButton value={title ? `${title}\n\n${content}` : content} label="复制内容" />
          ) : null}
          {dismissable ? (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="关闭"
              title="关闭"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text"
            >
              <Icon name="x" size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
