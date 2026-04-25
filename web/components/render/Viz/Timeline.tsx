"use client";

import { useMemo, useState } from "react";
import type { RenderProps } from "@/lib/component-registry";
import { cn } from "@/lib/cn";

type Status = "pending" | "in_progress" | "done" | "failed";

type Item = {
  title: string;
  status: Status;
  note?: string;
  time?: string;
};

const DOT_COLOR: Record<Status, string> = {
  pending: "bg-surface-3",
  in_progress: "bg-primary",
  done: "bg-success",
  failed: "bg-danger",
};
const DOT_RING: Record<Status, string> = {
  pending: "",
  in_progress: "animate-pulse-ring",
  done: "",
  failed: "",
};
const TITLE_COLOR: Record<Status, string> = {
  pending: "text-text-muted",
  in_progress: "text-text",
  done: "text-text",
  failed: "text-danger",
};
const STATUS_LABEL: Record<Status, string> = {
  pending: "待处理",
  in_progress: "进行中",
  done: "完成",
  failed: "失败",
};

function normStatus(raw: unknown): Status {
  if (raw === "done" || raw === "complete" || raw === "completed" || raw === "success")
    return "done";
  if (raw === "in_progress" || raw === "running" || raw === "active") return "in_progress";
  if (raw === "failed" || raw === "error") return "failed";
  return "pending";
}

/**
 * Brand-Blue V2 (ADR 0016) · timeline.
 *
 * Interactions (2026-04-25):
 *   - status pill row · click a status to toggle its visibility
 *   - "全部" pill     · resets the filter to show every status
 *   - count chips     · each pill shows the # of items in that status
 *
 * Filter chrome only renders when items > 4 so a 2-step status row stays
 * minimalist.
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

  // null = show all; set = show only those statuses
  const [filter, setFilter] = useState<Set<Status> | null>(null);

  const counts = useMemo(() => {
    const m: Record<Status, number> = { pending: 0, in_progress: 0, done: 0, failed: 0 };
    for (const it of items) m[it.status]++;
    return m;
  }, [items]);

  const visible = useMemo(() => {
    if (!filter) return items;
    return items.filter((it) => filter.has(it.status));
  }, [items, filter]);

  function togglePill(s: Status) {
    setFilter((cur) => {
      const set = new Set(cur ?? []);
      if (set.has(s)) {
        set.delete(s);
        return set.size === 0 ? null : set;
      }
      set.add(s);
      return set;
    });
  }

  const showFilters = items.length > 4;
  const FilterRow = showFilters ? (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-3">
      <button
        type="button"
        onClick={() => setFilter(null)}
        aria-pressed={filter === null}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-caption font-mono transition-colors duration-fast",
          filter === null
            ? "border-primary/40 bg-primary-muted text-primary"
            : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text",
        )}
      >
        全部
        <span className="tabular-nums">{items.length}</span>
      </button>
      {(Object.keys(STATUS_LABEL) as Status[])
        .filter((s) => counts[s] > 0)
        .map((s) => {
          const active = filter !== null && filter.has(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => togglePill(s)}
              aria-pressed={active}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-caption font-mono transition-colors duration-fast",
                active
                  ? "border-primary/40 bg-primary-muted text-primary"
                  : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text",
              )}
            >
              <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_COLOR[s]}`} />
              {STATUS_LABEL[s]}
              <span className="tabular-nums">{counts[s]}</span>
            </button>
          );
        })}
    </div>
  ) : null;

  if (layout === "horizontal") {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm overflow-x-auto animate-fade-up">
        {FilterRow}
        {visible.length === 0 ? (
          <div className="px-2 py-4 text-caption text-text-muted">没有匹配的事件</div>
        ) : (
          <ol className="flex items-start gap-6 min-w-max">
            {visible.map((item, i) => (
              <li key={i} className="relative flex flex-col items-start gap-2 min-w-[140px]">
                {i < visible.length - 1 && (
                  <span aria-hidden className="absolute left-2 top-1 h-px w-full bg-border" />
                )}
                <span
                  className={`relative z-10 h-2.5 w-2.5 rounded-full ${DOT_COLOR[item.status]} ${DOT_RING[item.status]}`}
                  aria-label={item.status}
                />
                <div className={`text-sm font-semibold ${TITLE_COLOR[item.status]}`}>{item.title || <span className="text-text-subtle">—</span>}</div>
                {item.time && (
                  <div className="text-caption text-text-subtle font-mono uppercase tracking-wider">
                    {item.time}
                  </div>
                )}
                {item.note && <div className="text-caption text-text-muted">{item.note}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm animate-fade-up">
      {FilterRow}
      {visible.length === 0 ? (
        <div className="px-2 py-4 text-caption text-text-muted">没有匹配的事件</div>
      ) : (
        <ol className="relative space-y-2.5">
          {visible.length > 1 && (
            <span aria-hidden className="absolute left-[5px] top-5 bottom-5 w-px bg-border" />
          )}
          {visible.map((item, i) => (
            <li key={i} className="relative flex items-start gap-3">
              <span
                className={`relative z-10 mt-2 h-2.5 w-2.5 rounded-full flex-shrink-0 ${DOT_COLOR[item.status]} ${DOT_RING[item.status]}`}
                aria-label={item.status}
              />
              <div className="flex-1 min-w-0 rounded-lg border border-border bg-surface p-3 shadow-soft-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <div className={`text-sm font-semibold ${TITLE_COLOR[item.status]}`}>{item.title || <span className="text-text-subtle">—</span>}</div>
                  {item.time && (
                    <div className="text-caption text-text-subtle font-mono uppercase tracking-wider">
                      {item.time}
                    </div>
                  )}
                </div>
                {item.note && (
                  <div className="mt-1 break-words text-caption text-text-muted">{item.note}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
