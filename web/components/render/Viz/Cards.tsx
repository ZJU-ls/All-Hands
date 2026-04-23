"use client";

import type { RenderProps } from "@/lib/component-registry";

type Card = {
  title: string;
  description: string;
  footer?: string;
  accent?: "default" | "primary" | "success" | "warn" | "error";
};

const ACCENT_BORDER: Record<NonNullable<Card["accent"]>, string> = {
  default: "border-border",
  primary: "border-primary",
  success: "border-success",
  warn: "border-warning",
  error: "border-danger",
};

// Thin top-edge accent (§11 hairline primitive). Gradient fades to
// transparent so the card still reads calmly from across the viewport.
const ACCENT_BAR: Record<NonNullable<Card["accent"]>, string> = {
  default: "",
  primary:
    "before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-gradient-to-r before:from-primary before:to-transparent before:opacity-70",
  success:
    "before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-gradient-to-r before:from-success before:to-transparent before:opacity-70",
  warn:
    "before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-gradient-to-r before:from-warning before:to-transparent before:opacity-70",
  error:
    "before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-gradient-to-r before:from-danger before:to-transparent before:opacity-70",
};

export function Cards({ props }: RenderProps) {
  const cards: Card[] = Array.isArray(props.cards)
    ? (props.cards as Card[]).filter((c): c is Card => !!c && typeof c.title === "string")
    : [];
  const columnsProp =
    typeof props.columns === "number" ? props.columns : undefined;
  const columns = Math.max(2, Math.min(4, columnsProp ?? 3));

  const gridColsClass =
    columns === 2
      ? "md:grid-cols-2"
      : columns === 3
        ? "md:grid-cols-3"
        : "md:grid-cols-4";

  if (cards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-bg p-3 text-xs text-text-muted">
        No cards
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 ${gridColsClass} gap-3`}>
      {cards.map((card, i) => {
        const accent = card.accent ?? "default";
        return (
          <div
            key={i}
            className={`relative overflow-hidden rounded-lg border bg-bg p-4 transition-colors duration-base hover:border-border-strong ${ACCENT_BORDER[accent] ?? ACCENT_BORDER.default} ${ACCENT_BAR[accent] ?? ""}`}
            style={{
              animation: `ah-fade-up var(--dur-mid) var(--ease-out) ${i * 40}ms both`,
            }}
          >
            <div className="text-sm font-semibold text-text mb-1 break-words">
              {card.title}
            </div>
            <div className="text-xs text-text-muted leading-relaxed break-words">
              {typeof card.description === "string" ? card.description : ""}
            </div>
            {card.footer && (
              <div className="text-[10px] text-text-subtle font-mono uppercase tracking-wider mt-3 pt-3 border-t border-border break-words">
                {card.footer}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
