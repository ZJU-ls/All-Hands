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

export function Cards({ props }: RenderProps) {
  const cards = (props.cards as Card[] | undefined) ?? [];
  const columnsProp = props.columns as number | undefined;
  const columns = Math.max(2, Math.min(4, columnsProp ?? 3));

  const gridColsClass =
    columns === 2
      ? "md:grid-cols-2"
      : columns === 3
      ? "md:grid-cols-3"
      : "md:grid-cols-4";

  return (
    <div className={`grid grid-cols-1 ${gridColsClass} gap-3`}>
      {cards.map((card, i) => {
        const accent = card.accent ?? "default";
        return (
          <div
            key={i}
            className={`rounded-lg border bg-bg p-4 transition-colors hover:border-text-muted ${ACCENT_BORDER[accent]}`}
          >
            <div className="text-sm font-semibold text-text mb-1">{card.title}</div>
            <div className="text-xs text-text-muted leading-relaxed">
              {card.description}
            </div>
            {card.footer && (
              <div className="text-xs text-text-muted font-mono mt-3 pt-3 border-t border-border">
                {card.footer}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
