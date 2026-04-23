"use client";

import type { RenderProps } from "@/lib/component-registry";

type Item = { label: string; value: string; hint?: string };

export function KV({ props }: RenderProps) {
  const items: Item[] = Array.isArray(props.items)
    ? (props.items as Item[]).filter(
        (it): it is Item => !!it && typeof it.label === "string",
      )
    : [];
  const title = typeof props.title === "string" ? props.title : undefined;

  return (
    <div
      className="rounded-lg border border-border bg-bg overflow-hidden transition-colors duration-base hover:border-border-strong"
      style={{ animation: "ah-fade-up var(--dur-mid) var(--ease-out)" }}
    >
      {title && (
        <div className="px-4 py-2.5 border-b border-border text-caption font-semibold uppercase tracking-[0.08em] text-text-muted bg-surface/60">
          <span className="text-text">{title}</span>
        </div>
      )}
      <dl className="divide-y divide-border">
        {items.length === 0 && (
          <div className="px-4 py-3 text-xs text-text-muted">No items</div>
        )}
        {items.map((item, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 px-4 py-2 text-sm transition-colors duration-fast hover:bg-surface-hover"
          >
            <dt className="text-text-muted font-mono text-xs pt-0.5 break-words">
              {item.label}
            </dt>
            <dd className="text-text min-w-0">
              <span className="break-words">
                {item.value == null ? (
                  <span className="text-text-subtle">—</span>
                ) : (
                  String(item.value)
                )}
              </span>
              {item.hint && (
                <span className="ml-2 text-[11px] text-text-muted">· {item.hint}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
