"use client";

import type { RenderProps } from "@/lib/component-registry";

type Bar = { label: string; value: number };
type Orientation = "vertical" | "horizontal";

// Some LLMs (and fuzzy tool-use training) return numeric values as strings
// ("12" instead of 12). Backend Pydantic uses `list[dict[str, Any]]` so the
// Any escape hatch passes the raw string through unchanged. Without this
// coercion every bar collapsed to height 0 (maxVal=0 → pct=0 → invisible),
// which was the "same height / only colored lines" bug the user reported.
function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

// Bars cycle the ADR-0012 data-viz palette by index, so categorical
// comparisons read distinct at a glance instead of a solid block of primary.
const BAR_COLORS = [
  "var(--color-viz-1)",
  "var(--color-viz-2)",
  "var(--color-viz-3)",
  "var(--color-viz-4)",
  "var(--color-viz-5)",
  "var(--color-viz-6)",
];

export function BarChart({ props }: RenderProps) {
  const bars: Bar[] = Array.isArray(props.bars)
    ? (props.bars as unknown[])
        .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
        .map((b) => ({
          label: typeof b.label === "string" ? b.label : "",
          value: toNumber(b.value),
        }))
    : [];
  const orientation: Orientation =
    props.orientation === "horizontal" ? "horizontal" : "vertical";
  const value_label =
    typeof props.value_label === "string" ? props.value_label : undefined;
  const caption = typeof props.caption === "string" ? props.caption : undefined;

  if (bars.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-bg p-3 text-xs text-text-muted">
        No bars
      </div>
    );
  }

  const maxVal = Math.max(...bars.map((b) => b.value), 0);
  const safeMax = maxVal === 0 ? 1 : maxVal;

  const cardClass =
    "rounded-lg border border-border bg-bg p-3 transition-colors duration-base hover:border-border-strong";
  const cardStyle = { animation: "ah-fade-up var(--dur-mid) var(--ease-out)" };

  if (orientation === "horizontal") {
    return (
      <div className={cardClass} style={cardStyle}>
        <div className="flex flex-col gap-2">
          {bars.map((b, i) => {
            const pct = Math.max(0, (b.value / safeMax) * 100);
            const color = BAR_COLORS[i % BAR_COLORS.length];
            return (
              <div
                key={i}
                className="group grid grid-cols-[minmax(64px,20%)_1fr_auto] items-center gap-2"
              >
                <div className="truncate text-xs text-text-muted group-hover:text-text transition-colors duration-fast">
                  {b.label}
                </div>
                <div className="relative h-3 rounded-sm bg-surface-2">
                  <div
                    className="absolute inset-y-0 left-0 rounded-sm shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition-[width,filter] duration-mid"
                    style={{
                      width: `${pct}%`,
                      background: color,
                      filter: "saturate(0.95)",
                    }}
                    aria-hidden
                  />
                </div>
                <div
                  className="w-12 text-right font-mono text-xs tabular-nums"
                  style={{ color }}
                >
                  {b.value}
                </div>
              </div>
            );
          })}
        </div>
        {(value_label || caption) && (
          <div className="mt-2 text-xs text-text-muted">
            {value_label}
            {value_label && caption ? " · " : ""}
            {caption}
          </div>
        )}
      </div>
    );
  }

  // Vertical — constrained-height bars with value labels on top
  return (
    <div className={cardClass} style={cardStyle}>
      <div className="flex h-40 items-end gap-2">
        {bars.map((b, i) => {
          const pct = Math.max(0, (b.value / safeMax) * 100);
          const color = BAR_COLORS[i % BAR_COLORS.length];
          return (
            <div
              key={i}
              className="group flex flex-1 flex-col items-center justify-end gap-1 min-w-0"
            >
              <div
                className="font-mono text-[10px] tabular-nums text-text-muted group-hover:text-text transition-colors duration-fast"
                style={{ color: `color-mix(in srgb, ${color} 80%, transparent)` }}
              >
                {b.value}
              </div>
              <div
                className="w-full rounded-t-sm shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition-[height,filter] duration-mid group-hover:[filter:saturate(1.1)]"
                style={{
                  height: `${pct}%`,
                  minHeight: b.value > 0 ? 2 : 0,
                  background: `linear-gradient(to top, ${color} 0%, color-mix(in srgb, ${color} 80%, transparent) 100%)`,
                }}
                aria-hidden
              />
              <div className="w-full truncate text-center text-[10px] text-text-muted">
                {b.label}
              </div>
            </div>
          );
        })}
      </div>
      {(value_label || caption) && (
        <div className="mt-2 text-xs text-text-muted">
          {value_label}
          {value_label && caption ? " · " : ""}
          {caption}
        </div>
      )}
    </div>
  );
}
