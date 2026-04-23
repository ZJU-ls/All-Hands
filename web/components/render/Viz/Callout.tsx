"use client";

import type { RenderProps } from "@/lib/component-registry";
import { Icon, type IconName } from "@/components/ui/icon";

type Kind = "info" | "warn" | "success" | "error";

// Tone classes — tinted background + tone border + tone text. Signals kind
// at a glance without a left bar.
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
 * rounded-xl + tinted tone background + tone border. Leading icon tile on
 * the left carries the kind; colored title carries it again. No left bar.
 */
export function Callout({ props }: RenderProps) {
  const kind = normKind(props.kind);
  const title = typeof props.title === "string" ? props.title : undefined;
  const content = typeof props.content === "string" ? props.content : "";
  const tone = TONE[kind];

  return (
    <div
      className={`relative flex gap-3 rounded-xl border px-4 py-3.5 animate-fade-up ${tone.bg}`}
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
    </div>
  );
}
