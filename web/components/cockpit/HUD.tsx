"use client";

/**
 * HUD · Cockpit "mission-control" greeting + ticker.
 *
 * V2 Azure Live restyle (ADR 0016): the HUD is now the landing's welcoming
 * hero — left cluster is a time-based greeting + autopilot/status chip, the
 * middle carries wall-clock + event rate micro-viz, right carries runtime
 * ops (pause / resume / refresh). Card uses `rounded-xl shadow-soft-sm`;
 * action buttons are pill-shaped with soft shadows.
 *
 * Behaviour / props / data flow are unchanged — this is a visual rework.
 * All icons go through `<Icon>` (ADR 0016 §D1).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { Sparkline } from "@/components/ui/Sparkline";
import type { ActivityEventDto, WorkspaceSummaryDto } from "@/lib/cockpit-api";

type Connection = "connecting" | "open" | "error";

function greetingKey(now: Date): "lateNight" | "morning" | "afternoon" | "evening" {
  const h = now.getHours();
  if (h < 5) return "lateNight";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function WallClock() {
  const t = useTranslations("cockpit.hud");
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) {
    return (
      <span className="font-mono text-caption tabular-nums text-text-subtle">
        --:--:--
      </span>
    );
  }
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return (
    <span
      className="font-mono text-caption tabular-nums text-text-muted"
      aria-label={t("wallClockAria")}
    >
      {hh}:{mm}:<span className="text-text">{ss}</span>
    </span>
  );
}

function Greeting() {
  const t = useTranslations("cockpit.hud");
  // Compute on the client so SSR doesn't lock a stale greeting.
  const [key, setKey] = useState<ReturnType<typeof greetingKey> | null>(null);
  useEffect(() => {
    setKey(greetingKey(new Date()));
  }, []);
  return (
    <span className="text-sm font-semibold text-text tracking-tight">
      {key ? t(key) : t("welcome")}
    </span>
  );
}

function StatusChip({
  kind,
  label,
}: {
  kind: "live" | "paused" | "reconnecting" | "offline";
  label: string;
}) {
  const dotColor =
    kind === "live"
      ? "bg-success"
      : kind === "paused"
        ? "bg-warning"
        : kind === "reconnecting"
          ? "bg-warning"
          : "bg-danger";
  const chipBg =
    kind === "live"
      ? "bg-success-soft text-success"
      : kind === "paused"
        ? "bg-warning-soft text-warning"
        : kind === "reconnecting"
          ? "bg-warning-soft text-warning"
          : "bg-danger-soft text-danger";
  const pulse = kind === "live" || kind === "reconnecting";
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full font-mono text-[10px] font-semibold uppercase tracking-wider ${chipBg}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${dotColor}`}
        style={
          pulse
            ? { animation: "ah-dot 1800ms ease-in-out infinite" }
            : undefined
        }
      />
      {label}
    </span>
  );
}

/** Bucket the last 5 minutes of events into 1-minute cells. Returns
 * 5 normalised values (oldest → newest) suitable for Sparkline input. */
function eventRateBuckets(
  events: ActivityEventDto[],
  now: Date = new Date(),
): { values: number[]; total: number; windowMs: number } {
  const WINDOW_MS = 5 * 60 * 1000;
  const BUCKET_MS = 60 * 1000;
  const BUCKETS = Math.floor(WINDOW_MS / BUCKET_MS);
  const counts = new Array<number>(BUCKETS).fill(0);
  const cutoff = now.getTime() - WINDOW_MS;
  let total = 0;
  for (const e of events) {
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t) || t < cutoff || t > now.getTime()) continue;
    const ageMs = now.getTime() - t;
    const idx = BUCKETS - 1 - Math.floor(ageMs / BUCKET_MS);
    if (idx >= 0 && idx < BUCKETS) {
      counts[idx] = (counts[idx] ?? 0) + 1;
      total += 1;
    }
  }
  const max = Math.max(1, ...counts);
  const values = counts.map((c) => c / max);
  return { values, total, windowMs: WINDOW_MS };
}

export function HUD({
  summary,
  connection,
  onPauseRequest,
  onResume,
  onRefresh,
}: {
  summary: WorkspaceSummaryDto;
  connection: Connection;
  onPauseRequest: () => void;
  onResume: () => void;
  onRefresh: () => void;
}) {
  const t = useTranslations("cockpit.hud");
  const rate = eventRateBuckets(summary.recent_events);

  const [statusKind, statusLabel]: [
    "live" | "paused" | "reconnecting" | "offline",
    string,
  ] = summary.paused
    ? ["paused", t("statusPaused")]
    : connection === "open"
      ? ["live", t("statusLive")]
      : connection === "connecting"
        ? ["reconnecting", t("statusReconnecting")]
        : ["offline", t("statusOffline")];

  return (
    <div
      className="relative flex items-center justify-between gap-4 min-h-12 px-4 py-2 rounded-xl border border-border bg-surface shadow-soft-sm overflow-hidden animate-fade-up"
      data-testid="cockpit-hud"
    >
      {/* Left cluster: greeting · status chip */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative h-8 w-8 shrink-0 rounded-lg overflow-hidden shadow-soft-sm grid place-items-center text-primary-fg"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)",
          }}
          aria-hidden="true"
        >
          <Icon name="sparkles" size={16} strokeWidth={2} />
        </div>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <Greeting />
            <StatusChip kind={statusKind} label={statusLabel} />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <WallClock />
            {summary.paused && summary.paused_reason && (
              <span className="font-mono text-[10px] text-text-subtle truncate max-w-[280px]">
                · {summary.paused_reason}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Middle cluster: event rate · badges */}
      <div className="hidden md:flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg bg-surface-2 border border-border">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
            {t("evRateLabel")}
          </span>
          <span
            className="font-mono text-caption tabular-nums text-text font-semibold"
            data-testid="hud-event-total"
          >
            {rate.total}
          </span>
          <div className="w-16 text-primary">
            <Sparkline
              values={rate.values}
              height={16}
              strokeWidth={1.5}
              showEndpoint={rate.total > 0}
              ariaLabel={t("evRateAria", { n: rate.total })}
            />
          </div>
        </div>
        {summary.tasks_needs_user > 0 && (
          <Link
            href="/tasks?filter=needs_user"
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-warning-soft text-warning border border-warning/30 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft"
            aria-label={t("tasksAria", { n: summary.tasks_needs_user })}
          >
            <Icon name="alert-circle" size={14} />
            <span className="font-mono text-[10px] tabular-nums font-semibold">
              {t("tasksLabel", { n: summary.tasks_needs_user })}
            </span>
          </Link>
        )}
        {summary.confirmations_pending > 0 && (
          <Link
            href="/confirmations"
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-warning-soft text-warning border border-warning/30 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft"
            aria-label={t("confirmAria", { n: summary.confirmations_pending })}
          >
            <Icon name="shield-check" size={14} />
            <span className="font-mono text-[10px] tabular-nums font-semibold">
              {t("confirmLabel", { n: summary.confirmations_pending })}
            </span>
          </Link>
        )}
      </div>

      {/* Right cluster: runtime ops */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface text-text-muted shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft hover:text-text hover:border-border-strong"
          title={t("refreshTitle")}
          aria-label={t("refreshAria")}
          data-testid="hud-refresh"
        >
          <Icon name="refresh" size={14} />
          <span className="hidden lg:inline font-mono text-[10px] uppercase tracking-wider font-semibold">
            {t("refreshLabel")}
          </span>
        </button>
        {summary.paused ? (
          <button
            type="button"
            onClick={onResume}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-warning-soft text-warning border border-warning/40 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft"
            data-testid="hud-resume"
          >
            <Icon name="play" size={14} />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">
              {t("resume")}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onPauseRequest}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-danger-soft text-danger border border-danger/40 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft"
            data-testid="hud-pause"
            aria-label={t("pauseAria")}
          >
            <Icon name="pause" size={14} />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">
              {t("pause")}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
