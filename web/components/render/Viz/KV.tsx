"use client";

import type { RenderProps } from "@/lib/component-registry";

type Item = { label: string; value: string; hint?: string };

/**
 * Brand-Blue V2 (ADR 0016) · key-value block.
 *
 * Shell: rounded-xl + shadow-soft-sm.
 * Keys: mono, uppercase, wide tracking, text-caption, text-text-muted.
 * Values: text-sm · text.
 */
export function KV({ props }: RenderProps) {
  const items: Item[] = Array.isArray(props.items)
    ? (props.items as Item[]).filter(
        (it): it is Item => !!it && typeof it.label === "string",
      )
    : [];
  const title = typeof props.title === "string" ? props.title : undefined;

  return (
    <div className="rounded-xl border border-border bg-surface shadow-soft-sm overflow-hidden animate-fade-up">
      {title && (
        <div className="px-4 py-2.5 border-b border-border bg-surface-2/60">
          <span className="text-caption font-mono font-semibold uppercase tracking-[0.18em] text-text">
            {title}
          </span>
        </div>
      )}
      <dl className="divide-y divide-border">
        {items.length === 0 && (
          <div className="px-4 py-3 text-caption text-text-muted">No items</div>
        )}
        {items.map((item, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(140px,30%)_1fr] gap-x-4 px-4 py-2.5"
          >
            <dt className="text-caption font-mono uppercase tracking-wider text-text-muted pt-0.5 break-words">
              {item.label}
            </dt>
            <dd className="text-sm text-text min-w-0">
              <span className="break-words">
                {item.value == null ? (
                  <span className="text-text-subtle">—</span>
                ) : (
                  String(item.value)
                )}
              </span>
              {item.hint && (
                <span className="ml-2 text-caption text-text-muted">
                  · {item.hint}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
