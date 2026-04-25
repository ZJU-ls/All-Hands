"use client";

import type { RenderProps } from "@/lib/component-registry";

type Bar = { label: string; value: number };
type Orientation = "vertical" | "horizontal";

// LLMs (and fuzzy tool-use) sometimes return numeric values as strings
// ("12" instead of 12). Backend uses Any so the raw string passes through.
// Without coercion maxVal=0 → every bar height 0 → invisible bars.
function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

// Bars cycle the ADR-0012 viz palette by index — categorical comparisons
// read distinct at a glance instead of a single-hue block.
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
 * Shell: rounded-xl · bg-surface · shadow-soft-sm.
 * Values right-mono-tabular · labels mono caption muted.
 */
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
  const title = typeof props.title === "string" ? props.title : undefined;
  const value_label =
    typeof props.value_label === "string" ? props.value_label : undefined;
  const caption = typeof props.caption === "string" ? props.caption : undefined;

  if (bars.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-caption text-text-muted">
        No bars
      </div>
    );
  }

  const maxVal = Math.max(...bars.map((b) => b.value), 0);
  const safeMax = maxVal === 0 ? 1 : maxVal;

  const shell =
    "rounded-xl border border-border bg-surface p-4 shadow-soft-sm animate-fade-up";

  const TitleBlock = title ? (
    <div className="mb-3 text-sm font-medium text-text">{title}</div>
  ) : null;

  const FooterBlock =
    value_label || caption ? (
      <div className="mt-3 text-caption font-mono text-text-muted">
        {value_label}
        {value_label && caption ? " · " : ""}
        {caption}
      </div>
    ) : null;

  if (orientation === "horizontal") {
    return (
      <div className={shell}>
        {TitleBlock}
        <div className="flex flex-col gap-2">
          {bars.map((b, i) => {
            const pct = Math.max(0, (b.value / safeMax) * 100);
            const color = BAR_COLORS[i % BAR_COLORS.length];
            return (
              <div
                key={i}
                className="group grid grid-cols-[minmax(72px,22%)_1fr_auto] items-center gap-2"
              >
                <div className="truncate text-caption font-mono text-text-muted">
                  {b.label}
                </div>
                <div className="relative h-3 rounded-sm bg-surface-2">
                  <div
                    className="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-mid"
                    style={{ width: `${pct}%`, background: color }}
                    aria-hidden
                  />
                </div>
                <div
                  className="w-14 text-right font-mono text-caption tabular-nums"
                  style={{ color }}
                >
                  {b.value}
                </div>
              </div>
            );
          })}
        </div>
        {FooterBlock}
      </div>
    );
  }

  return (
    <div className={shell}>
      {TitleBlock}
      <div className="flex h-44 items-stretch gap-2">
        {bars.map((b, i) => {
          const pct = Math.max(0, (b.value / safeMax) * 100);
          const color = BAR_COLORS[i % BAR_COLORS.length];
          return (
            <div
              key={i}
              className="group flex flex-1 flex-col items-center gap-1 min-w-0"
            >
              <div
                className="font-mono text-caption tabular-nums"
                style={{ color }}
              >
                {b.value}
              </div>
              {/* Track · flex-1 gives it a real height inside the h-44 row,
                  which the absolutely-positioned bar then resolves its
                  percent height against. Without this intermediate, the
                  column had no defined height and bars collapsed to 2px. */}
              <div className="relative w-full flex-1">
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t-sm transition-[height] duration-mid"
                  style={{
                    height: `${pct}%`,
                    minHeight: b.value > 0 ? 2 : 0,
                    background: `linear-gradient(to top, ${color} 0%, color-mix(in srgb, ${color} 70%, transparent) 100%)`,
                  }}
                  aria-hidden
                />
              </div>
              <div className="w-full truncate text-center text-caption font-mono text-text-muted">
                {b.label}
              </div>
            </div>
          );
        })}
      </div>
      {FooterBlock}
    </div>
  );
}
