"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { RenderProps } from "@/lib/component-registry";
import {
  SearchInput,
  matchesQuery,
} from "@/components/render/_shared/SearchInput";
import { ToolButton } from "@/components/render/_shared/Toolbar";

type Card = {
  title: string;
  description: string;
  footer?: string;
  accent?: "default" | "primary" | "success" | "warn" | "error";
};

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

type SortMode = "original" | "title-asc" | "title-desc";

/**
 * Brand-Blue V2 (ADR 0016) · grid of card items.
 *
 * Interactions (2026-04-25):
 *   - search · matches title + description + footer · live filter
 *   - sort   · title A→Z / Z→A / original (cycle)
 *
 * The toolbar only renders when there are >3 cards so a tiny "what is
 * this?" preview doesn't grow noisy chrome.
 */
export function Cards({ props }: RenderProps) {
  const t = useTranslations("viz.cards");
  const rawCards = props.cards;
  const cards: Card[] = useMemo(
    () =>
      Array.isArray(rawCards)
        ? (rawCards as Card[]).filter(
            (c): c is Card => !!c && typeof c.title === "string",
          )
        : [],
    [rawCards],
  );
  const columnsProp = typeof props.columns === "number" ? props.columns : undefined;
  const columns = Math.max(2, Math.min(4, columnsProp ?? 3));
  const gridColsClass =
    columns === 2 ? "md:grid-cols-2" : columns === 3 ? "md:grid-cols-3" : "md:grid-cols-4";

  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("original");

  const visible = useMemo(() => {
    let out = cards.map((c, i) => ({ card: c, _idx: i }));
    if (query) {
      out = out.filter(
        ({ card }) =>
          matchesQuery(card.title, query) ||
          matchesQuery(card.description, query) ||
          matchesQuery(card.footer, query),
      );
    }
    if (sortMode !== "original") {
      out.sort((a, b) =>
        sortMode === "title-asc"
          ? a.card.title.localeCompare(b.card.title)
          : b.card.title.localeCompare(a.card.title),
      );
    }
    return out;
  }, [cards, query, sortMode]);

  if (cards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-caption text-text-muted">
        {t("emptyAll")}
      </div>
    );
  }

  const showToolbar = cards.length > 3;
  const sortIcon =
    sortMode === "title-asc"
      ? "chevron-up"
      : sortMode === "title-desc"
      ? "chevron-down"
      : "chevrons-up-down";
  const sortLabel =
    sortMode === "title-asc"
      ? t("sortAToZ")
      : sortMode === "title-desc"
      ? t("sortZToA")
      : t("sortDefault");

  return (
    <div className="space-y-3">
      {showToolbar ? (
        <div className="flex items-center gap-2">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t("searchPlaceholder")}
            hint={query && visible.length !== cards.length ? `${visible.length}/${cards.length}` : undefined}
          />
          <ToolButton
            icon={sortIcon}
            label={sortLabel}
            onClick={() =>
              setSortMode((m) =>
                m === "original" ? "title-asc" : m === "title-asc" ? "title-desc" : "original",
              )
            }
            active={sortMode !== "original"}
          />
        </div>
      ) : null}
      <div className={`grid grid-cols-1 ${gridColsClass} gap-3`}>
        {visible.map(({ card, _idx }, displayIdx) => {
          const accent = card.accent ?? "default";
          return (
            <div
              key={_idx}
              className={`relative overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft ${ACCENT_BAR[accent] ?? ""}`}
              style={{
                animation: `ah-fade-up var(--dur-mid) var(--ease-out-expo) ${displayIdx * 40}ms both`,
              }}
            >
              <div className="mb-1 break-words text-sm font-semibold text-text">
                {card.title}
              </div>
              <div className="break-words text-caption leading-relaxed text-text-muted">
                {typeof card.description === "string" ? card.description : ""}
              </div>
              {card.footer && (
                <div className="mt-3 break-words border-t border-border pt-3 text-caption font-mono uppercase tracking-wider text-text-subtle">
                  {card.footer}
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 ? (
          <div className="col-span-full rounded-xl border border-dashed border-border bg-surface p-6 text-center text-caption text-text-muted">
            {t("empty")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
