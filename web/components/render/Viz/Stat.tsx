"use client";

import type { RenderProps } from "@/lib/component-registry";
import { Sparkline } from "@/components/ui/Sparkline";
import { Icon, type IconName } from "@/components/ui/icon";

type Direction = "up" | "down" | "flat";
type Tone = "positive" | "negative" | "neutral";

type Delta = {
  value: string | number;
  direction: Direction;
  tone?: Tone;
};

function normalizeDelta(raw: unknown): Delta | undefined {
  if (!raw) return undefined;

  let candidate = raw;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
  if (!candidate || typeof candidate !== "object") return undefined;

  const record = candidate as Record<string, unknown>;
  const value = record.value;
  if (typeof value !== "string" && typeof value !== "number") return undefined;

  const rawDirection = record.direction ?? record.trend;
  const direction: Direction =
    rawDirection === "up" || rawDirection === "down" || rawDirection === "flat"
      ? rawDirection
      : "flat";

  const tone: Tone =
    record.tone === "positive" || record.tone === "negative" || record.tone === "neutral"
      ? record.tone
      : "neutral";

  return { value, direction, tone };
}

const DIRECTION_ICON: Record<Direction, IconName> = {
  up: "trending-up",
  down: "trending-down",
  flat: "arrow-right",
};

// Delta pill: tone-tinted rounded-full with trend icon. Tone picks both
// fg + tinted bg via soft tokens so the pill reads at a glance.
const TONE_PILL: Record<Tone, string> = {
  positive: "text-success bg-success-soft",
  negative: "text-danger bg-danger-soft",
  neutral: "text-text-muted bg-surface-2",
};

/**
 * Brand-Blue V2 (ADR 0016) · KPI stat.
 *
 * Shell: rounded-xl · bg-surface · shadow-soft-sm
 * Label: mono caption · uppercase · wide tracking · muted
 * Value: text-2xl font-bold tabular-nums
 * Delta: tone-pill with trend icon
 * Accent hairline on top ties stat to its tone.
 */
export function Stat({ props }: RenderProps) {
  const label = typeof props.label === "string" ? props.label : "";
  const value =
    typeof props.value === "string" || typeof props.value === "number"
      ? props.value
      : undefined;
  const unit = typeof props.unit === "string" ? props.unit : undefined;
  const delta = normalizeDelta(props.delta);
  const spark: number[] = Array.isArray(props.spark)
    ? (props.spark as unknown[]).filter((v): v is number => typeof v === "number")
    : [];
  const caption = typeof props.caption === "string" ? props.caption : undefined;

  const tone: Tone = delta?.tone ?? "neutral";
  const direction: Direction = delta?.direction ?? "flat";
  const normSpark = (() => {
    if (spark.length < 2) return null;
    const min = Math.min(...spark);
    const max = Math.max(...spark);
    const range = max - min || 1;
    return spark.map((v) => (v - min) / range);
  })();

  const accentColor =
    tone === "positive"
      ? "var(--color-success)"
      : tone === "negative"
        ? "var(--color-danger)"
        : "var(--color-primary)";

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface px-4 py-3 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft animate-fade-up">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{
          background: `linear-gradient(to right, ${accentColor}, transparent)`,
          opacity: 0.7,
        }}
      />
      <div className="text-caption font-mono uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-text">
          {value == null ? "—" : String(value)}
        </span>
        {unit && (
          <span className="text-caption text-text-muted">{unit}</span>
        )}
        {delta && (
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium tabular-nums ${TONE_PILL[tone]}`}
          >
            <Icon name={DIRECTION_ICON[direction]} size={12} />
            {String(delta.value)}
          </span>
        )}
      </div>
      {normSpark && (
        <div className="mt-2" style={{ color: accentColor }}>
          <Sparkline values={normSpark} height={28} showEndpoint />
        </div>
      )}
      {caption && (
        <div className="mt-2 text-caption text-text-muted">{caption}</div>
      )}
    </div>
  );
}
