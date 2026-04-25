"use client";

import { useMemo, useState } from "react";
import type { RenderProps } from "@/lib/component-registry";
import { Toolbar, ToolButton } from "@/components/render/_shared/Toolbar";

type Bar = { label: string; value: number };
type Orientation = "vertical" | "horizontal";
type SortMode = "original" | "desc" | "asc";

function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

const BAR_COLORS = [
  "var(--color-viz-1)",
  "var(--color-viz-2)",
  "var(--color-viz-3)",
  "var(--color-viz-4)",
  "var(--color-viz-5)",
  "var(--color-viz-6)",
];

/**
 * Brand-Blue V2 (ADR 0016) · bar chart.
 *
 * Interactions (2026-04-25):
 *   - hover bar    · highlight + tooltip with precise value + share %
 *   - click bar    · toggle mute (greyscale + dropped from max calc)
 *   - sort toggle  · original / desc / asc · in toolbar
 *   - orientation kept as a prop · controls vertical vs horizontal
 */
export function BarChart({ props }: RenderProps) {
  const rawBars: Bar[] = Array.isArray(props.bars)
    ? (props.bars as unknown[])
        .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
        .map((b) => ({
          label: typeof b.label === "string" ? b.label : "",
          value: toNumber(b.value),
        }))
    : [];
  const orientation: Orientation =
    props.orientation === "horizontal" ? "horizontal" : "vertical";
  const title = typeof props.title === "string" ? props.title : undefined;
  const value_label =
    typeof props.value_label === "string" ? props.value_label : undefined;
  const caption = typeof props.caption === "string" ? props.caption : undefined;

  const [muted, setMuted] = useState<Set<number>>(() => new Set());
  const [sortMode, setSortMode] = useState<SortMode>("original");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  function toggleMute(idx: number) {
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }
  function cycleSort() {
    setSortMode((m) =>
      m === "original" ? "desc" : m === "desc" ? "asc" : "original",
    );
  }

  // Sort: keep original index alongside so colors / mute stay stable.
  const indexed = rawBars.map((b, i) => ({ ...b, _idx: i }));
  const ordered = useMemo(() => {
    if (sortMode === "original") return indexed;
    const out = [...indexed];
    out.sort((a, b) =>
      sortMode === "desc" ? b.value - a.value : a.value - b.value,
    );
    return out;
  }, [indexed, sortMode]);

  // Max excludes muted bars so live bars rescale when the user "removes"
  // an outlier — that's the whole point of the click-to-mute affordance.
  const maxVal = Math.max(
    ...ordered
      .filter((b) => !muted.has(b._idx))
      .map((b) => b.value),
    0,
  );
  const safeMax = maxVal === 0 ? 1 : maxVal;
  const totalLive = ordered
    .filter((b) => !muted.has(b._idx))
    .reduce((s, b) => s + b.value, 0);

  if (rawBars.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-caption text-text-muted">
        No bars
      </div>
    );
  }

  const sortIcon =
    sortMode === "desc"
      ? "chevron-down"
      : sortMode === "asc"
      ? "chevron-up"
      : "chevrons-up-down";
  const sortLabel =
    sortMode === "desc"
      ? "排序 · 降序(再点切换)"
      : sortMode === "asc"
      ? "排序 · 升序(再点恢复)"
      : "排序 · 原序(点击切换)";

  const FooterBlock =
    value_label || caption ? (
      <div className="border-t border-border bg-surface-2/30 px-4 py-2 text-caption font-mono text-text-muted">
        {value_label}
        {value_label && caption ? " · " : ""}
        {caption}
      </div>
    ) : null;

  if (orientation === "horizontal") {
    return (
      <div className="rounded-xl border border-border bg-surface shadow-soft-sm animate-fade-up overflow-hidden">
        <Toolbar title={title}>
          <ToolButton icon={sortIcon} label={sortLabel} onClick={cycleSort} active={sortMode !== "original"} />
        </Toolbar>
        <div className="flex flex-col gap-2 p-4">
          {ordered.map((b) => {
            const isMuted = muted.has(b._idx);
            const pct = isMuted ? 0 : Math.max(0, (b.value / safeMax) * 100);
            const color = BAR_COLORS[b._idx % BAR_COLORS.length];
            const sharePct = totalLive ? ((b.value / totalLive) * 100).toFixed(1) : "0.0";
            return (
              <button
                key={b._idx}
                type="button"
                onClick={() => toggleMute(b._idx)}
                onMouseEnter={() => setHoverIndex(b._idx)}
                onMouseLeave={() => setHoverIndex(null)}
                title={isMuted ? "已隐藏 · 点击恢复" : `${b.value} · 占比 ${sharePct}% · 点击隐藏`}
                className="group grid grid-cols-[minmax(72px,22%)_1fr_auto] items-center gap-2 rounded-md px-1 py-1 text-left transition-colors duration-fast hover:bg-surface-2/40"
              >
                <div className={`truncate text-caption font-mono ${isMuted ? "text-text-subtle line-through" : "text-text-muted"}`}>
                  {b.label}
                </div>
                <div className="relative h-3 rounded-sm bg-surface-2">
                  <div
                    className="absolute inset-y-0 left-0 rounded-sm transition-[width,opacity] duration-mid"
                    style={{
                      width: `${pct}%`,
                      background: color,
                      opacity: isMuted ? 0 : hoverIndex === b._idx ? 1 : 0.92,
                    }}
                    aria-hidden
                  />
                </div>
                <div
                  className={`w-14 text-right font-mono text-caption tabular-nums ${isMuted ? "text-text-subtle line-through" : ""}`}
                  style={{ color: isMuted ? undefined : color }}
                >
                  {b.value}
                </div>
              </button>
            );
          })}
        </div>
        {FooterBlock}
      </div>
    );
  }

  // Vertical
  return (
    <div className="rounded-xl border border-border bg-surface shadow-soft-sm animate-fade-up overflow-hidden">
      <Toolbar title={title}>
        <ToolButton icon={sortIcon} label={sortLabel} onClick={cycleSort} active={sortMode !== "original"} />
      </Toolbar>
      <div className="flex h-44 items-stretch gap-2 p-4 pb-2">
        {ordered.map((b) => {
          const isMuted = muted.has(b._idx);
          const pct = isMuted ? 0 : Math.max(0, (b.value / safeMax) * 100);
          const color = BAR_COLORS[b._idx % BAR_COLORS.length];
          const sharePct = totalLive ? ((b.value / totalLive) * 100).toFixed(1) : "0.0";
          const isHovered = hoverIndex === b._idx;
          return (
            <button
              key={b._idx}
              type="button"
              onClick={() => toggleMute(b._idx)}
              onMouseEnter={() => setHoverIndex(b._idx)}
              onMouseLeave={() => setHoverIndex(null)}
              title={isMuted ? "已隐藏 · 点击恢复" : `${b.value} · 占比 ${sharePct}% · 点击隐藏`}
              className="group flex flex-1 flex-col items-center gap-1 min-w-0"
            >
              <div
                className={`font-mono text-caption tabular-nums transition-colors duration-fast ${isMuted ? "text-text-subtle line-through" : ""}`}
                style={{ color: isMuted ? undefined : color }}
              >
                {b.value}
              </div>
              <div className="relative w-full flex-1">
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t-sm transition-[height,opacity] duration-mid"
                  style={{
                    height: `${pct}%`,
                    minHeight: !isMuted && b.value > 0 ? 2 : 0,
                    background: `linear-gradient(to top, ${color} 0%, color-mix(in srgb, ${color} 70%, transparent) 100%)`,
                    opacity: isMuted ? 0 : isHovered ? 1 : 0.92,
                    outline: isHovered && !isMuted ? `2px solid ${color}` : "none",
                    outlineOffset: -1,
                  }}
                  aria-hidden
                />
                {isHovered && !isMuted ? (
                  <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2 py-1 text-caption font-mono text-text shadow-pop whitespace-nowrap">
                    {b.label} · <span style={{ color }}>{b.value}</span> · {sharePct}%
                  </div>
                ) : null}
              </div>
              <div className={`w-full truncate text-center text-caption font-mono ${isMuted ? "text-text-subtle line-through" : "text-text-muted"}`}>
                {b.label}
              </div>
            </button>
          );
        })}
      </div>
      {FooterBlock}
    </div>
  );
}
