"use client";

import type { RenderProps } from "@/lib/component-registry";

type Item = {
  title: string;
  status: "pending" | "in_progress" | "done" | "failed";
  note?: string;
  time?: string;
};

const DOT_COLOR: Record<Item["status"], string> = {
  pending: "bg-text-subtle",
  in_progress: "bg-primary",
  done: "bg-success",
  failed: "bg-danger",
};

export function Timeline({ props }: RenderProps) {
  const items = (props.items as Item[] | undefined) ?? [];
  const layout = (props.layout as string | undefined) ?? "vertical";

  if (layout === "horizontal") {
    return (
      <div className="rounded-lg border border-border bg-bg p-4 overflow-x-auto">
        <ol className="flex items-start gap-6 min-w-max">
          {items.map((item, i) => (
            <li key={i} className="flex flex-col items-start gap-2 min-w-[120px]">
              <span
                className={`h-2 w-2 rounded-full ${DOT_COLOR[item.status]}`}
                aria-label={item.status}
              />
              <div className="text-sm font-semibold text-text">{item.title}</div>
              {item.time && (
                <div className="text-xs text-text-muted font-mono">{item.time}</div>
              )}
              {item.note && (
                <div className="text-xs text-text-muted">{item.note}</div>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <ol className="rounded-lg border border-border bg-bg px-4 py-3 space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3">
          <span
            className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${DOT_COLOR[item.status]}`}
            aria-label={item.status}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-sm font-semibold text-text">{item.title}</div>
              {item.time && (
                <div className="text-xs text-text-muted font-mono">{item.time}</div>
              )}
            </div>
            {item.note && (
              <div className="text-xs text-text-muted mt-0.5">{item.note}</div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
