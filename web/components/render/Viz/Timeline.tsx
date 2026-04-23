"use client";

import type { RenderProps } from "@/lib/component-registry";

type Item = {
  title: string;
  status: "pending" | "in_progress" | "done" | "failed";
  note?: string;
  time?: string;
};

const DOT_COLOR: Record<Item["status"], string> = {
  pending: "bg-surface-3",
  in_progress: "bg-primary",
  done: "bg-success",
  failed: "bg-danger",
};

const DOT_RING: Record<Item["status"], string> = {
  pending: "",
  in_progress: "animate-pulse-ring",
  done: "",
  failed: "",
};

const TITLE_COLOR: Record<Item["status"], string> = {
  pending: "text-text-muted",
  in_progress: "text-text",
  done: "text-text",
  failed: "text-danger",
};

function normStatus(raw: unknown): Item["status"] {
  if (raw === "done" || raw === "complete" || raw === "completed" || raw === "success")
    return "done";
  if (raw === "in_progress" || raw === "running" || raw === "active") return "in_progress";
  if (raw === "failed" || raw === "error") return "failed";
  return "pending";
}

/**
 * Brand-Blue V2 (ADR 0016) · timeline.
 *
 * Left rail with dot + connector. Each event card: rounded-lg · bg-surface
 * · shadow-soft-sm.
 */
export function Timeline({ props }: RenderProps) {
  const itemsRaw = Array.isArray(props.items) ? (props.items as unknown[]) : [];
  const items: Item[] = itemsRaw
    .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
    .map((it) => ({
      title: typeof it.title === "string" ? it.title : "",
      status: normStatus(it.status),
      note: typeof it.note === "string" ? it.note : undefined,
      time: typeof it.time === "string" ? it.time : undefined,
    }));
  const layout = props.layout === "horizontal" ? "horizontal" : "vertical";

  if (layout === "horizontal") {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm overflow-x-auto animate-fade-up">
        <ol className="flex items-start gap-6 min-w-max">
          {items.map((item, i) => (
            <li
              key={i}
              className="flex flex-col items-start gap-2 min-w-[140px] relative"
            >
              {i < items.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-2 top-1 h-px w-full bg-border"
                />
              )}
              <span
                className={`relative z-10 h-2.5 w-2.5 rounded-full ${DOT_COLOR[item.status]} ${DOT_RING[item.status]}`}
                aria-label={item.status}
              />
              <div className={`text-sm font-semibold ${TITLE_COLOR[item.status]}`}>
                {item.title}
              </div>
              {item.time && (
                <div className="text-caption text-text-subtle font-mono uppercase tracking-wider">
                  {item.time}
                </div>
              )}
              {item.note && (
                <div className="text-caption text-text-muted">{item.note}</div>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <ol className="relative rounded-xl border border-border bg-surface px-4 py-3 space-y-2.5 shadow-soft-sm animate-fade-up">
      {items.length > 1 && (
        <span
          aria-hidden
          className="absolute left-[calc(1rem+5px)] top-5 bottom-5 w-px bg-border"
        />
      )}
      {items.map((item, i) => (
        <li key={i} className="relative flex items-start gap-3">
          <span
            className={`relative z-10 mt-2 h-2.5 w-2.5 rounded-full flex-shrink-0 ${DOT_COLOR[item.status]} ${DOT_RING[item.status]}`}
            aria-label={item.status}
          />
          <div className="flex-1 min-w-0 rounded-lg bg-surface border border-border p-3 shadow-soft-sm">
            <div className="flex items-baseline justify-between gap-2">
              <div
                className={`text-sm font-semibold ${TITLE_COLOR[item.status]}`}
              >
                {item.title}
              </div>
              {item.time && (
                <div className="text-caption text-text-subtle font-mono uppercase tracking-wider">
                  {item.time}
                </div>
              )}
            </div>
            {item.note && (
              <div className="text-caption text-text-muted mt-1 break-words">
                {item.note}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
