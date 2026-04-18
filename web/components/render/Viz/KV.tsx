"use client";

import type { RenderProps } from "@/lib/component-registry";

type Item = { label: string; value: string; hint?: string };

export function KV({ props }: RenderProps) {
  const items = (props.items as Item[] | undefined) ?? [];
  const title = props.title as string | undefined;

  return (
    <div className="rounded-lg border border-border bg-bg overflow-hidden">
      {title && (
        <div className="px-4 py-2 border-b border-border text-xs font-semibold text-text-muted">
          {title}
        </div>
      )}
      <dl className="px-4 py-3 grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 gap-y-2 text-sm">
        {items.map((item, i) => (
          <div key={i} className="contents">
            <dt className="text-text-muted font-mono text-xs pt-0.5">{item.label}</dt>
            <dd className="text-text">
              <span>{item.value}</span>
              {item.hint && (
                <span className="ml-2 text-xs text-text-muted">· {item.hint}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
