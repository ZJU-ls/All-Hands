"use client";

import type { RenderProps } from "@/lib/component-registry";

type Card = {
  title: string;
  description: string;
  footer?: string;
  accent?: "default" | "primary" | "success" | "warn" | "error";
};

// Colored top-edge hairline per accent. ADR 0016 D3 unbans this primitive.
const ACCENT_BAR: Record<NonNullable<Card["accent"]>, string> = {
  default: "",
  primary:
    "before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-gradient-to-r before:from-primary before:to-transparent before:opacity-80",
  success:
    "before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-gradient-to-r before:from-success before:to-transparent before:opacity-80",
  warn:
    "before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-gradient-to-r before:from-warning before:to-transparent before:opacity-80",
  error:
    "before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-gradient-to-r before:from-danger before:to-transparent before:opacity-80",
};

/**
 * Brand-Blue V2 (ADR 0016) · grid of card items.
 *
 * Each card: rounded-xl · bg-surface · shadow-soft-sm · hover:-translate-y-px
 * + hover:shadow-soft. Accent tone adds a top hairline (no border swap —
 * card stays calm at rest).
 */
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
      <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-caption text-text-muted">
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
            className={`relative overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft ${ACCENT_BAR[accent] ?? ""}`}
            style={{
              animation: `ah-fade-up var(--dur-mid) var(--ease-out-expo) ${i * 40}ms both`,
            }}
          >
            <div className="text-sm font-semibold text-text mb-1 break-words">
              {card.title}
            </div>
            <div className="text-caption text-text-muted leading-relaxed break-words">
              {typeof card.description === "string" ? card.description : ""}
            </div>
            {card.footer && (
              <div className="text-caption text-text-subtle font-mono uppercase tracking-wider mt-3 pt-3 border-t border-border break-words">
                {card.footer}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
