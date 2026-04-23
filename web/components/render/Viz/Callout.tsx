"use client";

import type { RenderProps } from "@/lib/component-registry";

type Kind = "info" | "warn" | "success" | "error";

const BAR_COLOR: Record<Kind, string> = {
  info: "bg-primary",
  warn: "bg-warning",
  success: "bg-success",
  error: "bg-danger",
};

const TITLE_COLOR: Record<Kind, string> = {
  info: "text-primary",
  warn: "text-warning",
  success: "text-success",
  error: "text-danger",
};

// Semi-transparent tint per kind (ADR-0012 *-soft tokens) + matching border
// so the callout reads as a distinct semantic block, not a generic card.
const BG_CLASS: Record<Kind, string> = {
  info: "bg-primary-soft border-primary/20",
  warn: "bg-warning-soft border-warning/30",
  success: "bg-success-soft border-success/30",
  error: "bg-danger-soft border-danger/30",
};

const GLYPH: Record<Kind, string> = {
  info: "i",
  warn: "!",
  success: "✓",
  error: "✕",
};

const KINDS: readonly Kind[] = ["info", "warn", "success", "error"] as const;

function normKind(raw: unknown): Kind {
  if (typeof raw === "string" && (KINDS as readonly string[]).includes(raw)) {
    return raw as Kind;
  }
  // Common synonyms the model might emit
  if (raw === "warning") return "warn";
  if (raw === "ok" || raw === "done") return "success";
  if (raw === "danger" || raw === "err") return "error";
  return "info";
}

export function Callout({ props }: RenderProps) {
  const kind = normKind(props.kind);
  const title = typeof props.title === "string" ? props.title : undefined;
  const content = typeof props.content === "string" ? props.content : "";

  // ADR 0013: impeccable BAN 1 forbids accent stripes on callouts. Structure
  // is now: tinted background (signals kind via `*-soft` token) + leading
  // glyph circle (signals kind via tone-colored disc) + colored title.
  // No left bar — the tinted bg + glyph carry the semantic load.
  return (
    <div
      className={`relative flex gap-3 rounded-lg border px-4 py-3.5 ${BG_CLASS[kind]}`}
      style={{ animation: "ah-fade-up var(--dur-mid) var(--ease-out-quart)" }}
    >
      <span
        aria-hidden
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold ${BAR_COLOR[kind]} text-primary-fg`}
      >
        {GLYPH[kind]}
      </span>
      <div className="min-w-0 flex-1">
        {title && (
          <div
            className={`text-caption font-semibold ${TITLE_COLOR[kind]} mb-1 uppercase tracking-wider break-words`}
          >
            {title}
          </div>
        )}
        <div className="text-base text-text leading-[1.55] whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    </div>
  );
}
