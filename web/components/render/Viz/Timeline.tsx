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

const DOT_RING: Record<Item["status"], string> = {
  pending: "",
  in_progress: "ring-4 ring-primary-soft",
  done: "ring-2 ring-success-soft",
  failed: "ring-2 ring-danger-soft",
};

const TITLE_COLOR: Record<Item["status"], string> = {
  pending: "text-text-muted",
  in_progress: "text-text",
  done: "text-text",
  failed: "text-danger",
};

function normStatus(raw: unknown): Item["status"] {
  // Accept common synonyms the model might emit so the dot still colors
  // correctly instead of falling back to an undefined Tailwind class.
  if (raw === "done" || raw === "complete" || raw === "completed" || raw === "success")
    return "done";
  if (raw === "in_progress" || raw === "running" || raw === "active") return "in_progress";
  if (raw === "failed" || raw === "error") return "failed";
  return "pending";
}

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

  const cardStyle = { animation: "ah-fade-up var(--dur-mid) var(--ease-out)" };

  if (layout === "horizontal") {
    return (
      <div
        className="rounded-lg border border-border bg-bg p-4 overflow-x-auto"
        style={cardStyle}
      >
        <ol className="flex items-start gap-6 min-w-max">
          {items.map((item, i) => (
            <li
              key={i}
              className="flex flex-col items-start gap-2 min-w-[120px] relative"
            >
              {/* horizontal connector to the next item */}
              {i < items.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-2 top-1 h-px w-full bg-border"
                />
              )}
              <span
                className={`relative z-10 h-2 w-2 rounded-full ${DOT_COLOR[item.status]} ${DOT_RING[item.status]}`}
                aria-label={item.status}
              />
              <div className={`text-sm font-semibold ${TITLE_COLOR[item.status]}`}>
                {item.title}
              </div>
              {item.time && (
                <div className="text-[10px] text-text-subtle font-mono uppercase tracking-wider">
                  {item.time}
                </div>
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
    <ol
      className="relative rounded-lg border border-border bg-bg px-4 py-3 space-y-3"
      style={cardStyle}
    >
      {/* vertical spine connecting all dots */}
      {items.length > 1 && (
        <span
          aria-hidden
          className="absolute left-[calc(1rem+3px)] top-5 bottom-5 w-px bg-border"
        />
      )}
      {items.map((item, i) => (
        <li key={i} className="relative flex items-start gap-3">
          <span
            className={`relative z-10 mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${DOT_COLOR[item.status]} ${DOT_RING[item.status]}`}
            aria-label={item.status}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <div
                className={`text-sm font-semibold ${TITLE_COLOR[item.status]}`}
              >
                {item.title}
              </div>
              {item.time && (
                <div className="text-[10px] text-text-subtle font-mono uppercase tracking-wider">
                  {item.time}
                </div>
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
