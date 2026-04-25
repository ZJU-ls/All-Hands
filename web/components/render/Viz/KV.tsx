"use client";

import { useMemo, useState } from "react";
import type { RenderProps } from "@/lib/component-registry";
import { CopyButton } from "@/components/render/_shared/CopyButton";
import {
  SearchInput,
  matchesQuery,
} from "@/components/render/_shared/SearchInput";

type Item = { label: string; value: string; hint?: string };

/**
 * Brand-Blue V2 (ADR 0016) · key-value block.
 *
 * Interactions (2026-04-25):
 *   - search   · filter by label / value / hint (chrome appears for >5 items)
 *   - per-row copy · copies the value to clipboard, hover-revealed
 */
export function KV({ props }: RenderProps) {
  const rawItems = props.items;
  const items: Item[] = useMemo(
    () =>
      Array.isArray(rawItems)
        ? (rawItems as Item[]).filter(
            (it): it is Item => !!it && typeof it.label === "string",
          )
        : [],
    [rawItems],
  );
  const title = typeof props.title === "string" ? props.title : undefined;

  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    if (!query) return items;
    return items.filter(
      (it) =>
        matchesQuery(it.label, query) ||
        matchesQuery(it.value, query) ||
        matchesQuery(it.hint, query),
    );
  }, [items, query]);

  const showSearch = items.length > 5;

  return (
    <div className="rounded-xl border border-border bg-surface shadow-soft-sm overflow-hidden animate-fade-up">
      {(title || showSearch) && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2">
          {title ? (
            <span className="flex-1 text-caption font-mono font-semibold uppercase tracking-[0.18em] text-text">
              {title}
            </span>
          ) : (
            <div className="flex-1" />
          )}
          {showSearch ? (
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="筛选键…"
              hint={query && visible.length !== items.length ? `${visible.length}/${items.length}` : undefined}
            />
          ) : null}
        </div>
      )}
      <dl className="divide-y divide-border">
        {items.length === 0 && (
          <div className="px-4 py-3 text-caption text-text-muted">No items</div>
        )}
        {visible.length === 0 && items.length > 0 && (
          <div className="px-4 py-3 text-caption text-text-muted">没有匹配的项</div>
        )}
        {visible.map((item, i) => (
          <div
            key={i}
            className="group grid grid-cols-[minmax(140px,30%)_1fr_auto] items-center gap-x-4 px-4 py-2.5"
          >
            <dt className="break-words pt-0.5 text-caption font-mono uppercase tracking-wider text-text-muted">
              {item.label}
            </dt>
            <dd className="min-w-0 text-sm text-text">
              <span className="break-words">
                {item.value == null ? (
                  <span className="text-text-subtle">—</span>
                ) : (
                  String(item.value)
                )}
              </span>
              {item.hint && (
                <span className="ml-2 text-caption text-text-muted">· {item.hint}</span>
              )}
            </dd>
            {item.value != null ? (
              <span className="opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-within:opacity-100">
                <CopyButton value={String(item.value)} label={`复制 ${item.label}`} />
              </span>
            ) : (
              <span aria-hidden className="h-6 w-6" />
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}
