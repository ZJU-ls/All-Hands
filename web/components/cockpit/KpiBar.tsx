"use client";

/**
 * KpiBar · Cockpit KPI console (V2 Azure Live · ADR 0016).
 *
 * Restyle: flat 7-cell border grid → 4×2 rich stat-card grid. The first
 * card (今日聚焦) is a gradient primary card with a blurred inner orb,
 * the remaining cards sit on `surface-2`/`surface` with `shadow-soft-sm`
 * and lift on hover (`-translate-y-px` + `shadow-soft`). Numbers grow a
 * touch larger and pick up semantic tone via inline trend pills.
 *
 * Behaviour / data / `data-testid` contract unchanged. Icons route via
 * `<Icon>` (ADR 0016 §D1).
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/ui/icon";
import type { WorkspaceSummaryDto } from "@/lib/cockpit-api";

type Tone = "neutral" | "warn";
type Kpi = {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: Tone;
  icon: IconName;
  /** Optional small trend annotation: up + success, down + danger, flat muted. */
  trend?: { direction: "up" | "down" | "flat"; label: string; tone: "success" | "danger" | "muted" };
};

// formatTokens centralised in `web/lib/format.ts` — re-export for callsites
// that previously imported it from this module.
import { formatTokens } from "@/lib/format";

type KpiTranslate = (key: string, values?: Record<string, string | number>) => string;

function buildKpis(s: WorkspaceSummaryDto, t: KpiTranslate): { hero: Kpi; cards: Kpi[] } {
  const tasksTone: Tone = s.tasks_needs_user > 0 ? "warn" : "neutral";
  const runsTone: Tone = s.runs_failing_recently > 0 ? "warn" : "neutral";

  // The hero cell surfaces the "what's happening right now" metric: active
  // runs. Falls back to employees count when nothing is running so the hero
  // card is never empty-looking on a quiet workspace.
  const hero: Kpi = s.runs_active > 0
    ? {
        label: t("active"),
        value: String(s.runs_active),
        hint:
          s.runs_failing_recently > 0
            ? t("failedRecent", { n: s.runs_failing_recently })
            : t("running"),
        icon: "zap",
        trend: { direction: "up", label: t("live"), tone: "success" },
      }
    : {
        label: t("employees"),
        value: String(s.employees_total),
        hint: t("convsHint", { n: s.conversations_today }),
        icon: "users",
        href: "/employees",
        trend: { direction: "flat", label: t("idle"), tone: "muted" },
      };

  const cards: Kpi[] = [
    {
      label: t("tasks"),
      value: String(s.tasks_active),
      hint:
        s.tasks_needs_user > 0
          ? t("tasksWaiting", { n: s.tasks_needs_user })
          : s.tasks_active > 0
            ? t("running")
            : t("dash"),
      icon: "list",
      href: "/tasks",
      tone: tasksTone,
    },
    {
      label: t("runsActive"),
      value: String(s.runs_active),
      hint: s.runs_failing_recently > 0 ? t("failedRecent", { n: s.runs_failing_recently }) : t("stable"),
      icon: "play-circle",
      tone: runsTone,
    },
    {
      label: t("triggers"),
      value: String(s.triggers_active),
      hint: t("triggersHint"),
      icon: "zap",
      href: "/triggers",
    },
    {
      label: t("artifacts"),
      value: String(s.artifacts_total),
      hint: t("artifactsHint", { n: s.artifacts_this_week_delta }),
      icon: "file",
      trend:
        s.artifacts_this_week_delta > 0
          ? { direction: "up", label: `+${s.artifacts_this_week_delta}`, tone: "success" }
          : undefined,
    },
    {
      label: t("tokens24h"),
      value: formatTokens(s.tokens_today_total),
      hint: t("tokensSplit", {
        prompt: formatTokens(s.tokens_today_prompt),
        completion: formatTokens(s.tokens_today_completion),
      }),
      icon: "brain",
    },
    {
      label: t("cost24h"),
      value: `$${s.estimated_cost_today_usd.toFixed(2)}`,
      hint: s.tokens_today_total > 0 ? t("estimated") : t("dash"),
      icon: "database",
    },
    {
      label: t("convs24h"),
      value: String(s.conversations_today),
      hint: t("last24h"),
      icon: "message-square",
    },
  ];

  return { hero, cards };
}

function TrendPill({ trend }: { trend: NonNullable<Kpi["trend"]> }) {
  const arrow =
    trend.direction === "up" ? "arrow-up" : trend.direction === "down" ? "arrow-down" : "minus";
  const tone =
    trend.tone === "success"
      ? "text-success"
      : trend.tone === "danger"
        ? "text-danger"
        : "text-text-subtle";
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-caption tabular-nums ${tone}`}>
      <Icon name={arrow} size={12} strokeWidth={2} />
      {trend.label}
    </span>
  );
}

function HeroCard({ k }: { k: Kpi }) {
  const content = (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl"
        style={{ background: "var(--color-accent)", opacity: 0.42 }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-12 bottom-0 h-24 w-24 rounded-full blur-2xl"
        style={{ background: "var(--color-primary-glow)", opacity: 0.3 }}
      />
      <div className="relative flex items-center justify-between">
        <span className="font-mono text-caption uppercase tracking-wider opacity-85">
          {k.label}
        </span>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
          <Icon name={k.icon} size={14} strokeWidth={2} />
        </span>
      </div>
      <div className="relative mt-3 text-xl font-bold tabular-nums leading-none">
        {k.value}
      </div>
      <div className="relative mt-2 flex items-center justify-between gap-2">
        {k.trend ? (
          <span className="inline-flex items-center gap-1 font-mono text-caption opacity-95">
            <Icon
              name={
                k.trend.direction === "up"
                  ? "arrow-up"
                  : k.trend.direction === "down"
                    ? "arrow-down"
                    : "minus"
              }
              size={12}
              strokeWidth={2}
            />
            {k.trend.label}
          </span>
        ) : (
          <span />
        )}
        {k.hint && (
          <span className="font-mono text-caption opacity-80 truncate">
            {k.hint}
          </span>
        )}
      </div>
    </>
  );
  const base =
    "group relative overflow-hidden rounded-xl p-4 text-primary-fg shadow-soft transition duration-base hover:-translate-y-px hover:shadow-soft-lg";
  const style: React.CSSProperties = {
    background:
      "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)",
  };
  if (k.href) {
    return (
      <Link href={k.href} className={base} style={style} data-testid={`kpi-${k.label}`}>
        {content}
      </Link>
    );
  }
  return (
    <div className={base} style={style} data-testid={`kpi-${k.label}`}>
      {content}
    </div>
  );
}

function StatCard({ k }: { k: Kpi }) {
  const warn = k.tone === "warn";
  const numberColor = warn ? "text-warning" : "text-text";
  const iconBg = warn
    ? "bg-warning-soft text-warning"
    : "bg-primary-muted text-primary";
  const base =
    "group relative flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft hover:border-border-strong";
  const content = (
    <>
      {warn && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r bg-warning"
          style={{
            animation: "ah-bar-in 180ms var(--ease-out) both",
            transformOrigin: "center",
          }}
        />
      )}
      <div className="flex items-center justify-between">
        <span className="font-mono text-caption font-semibold uppercase tracking-wider text-text-subtle truncate">
          {k.label}
        </span>
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon name={k.icon} size={14} strokeWidth={2} />
        </span>
      </div>
      <div className={`text-xl font-bold tabular-nums leading-none ${numberColor}`}>
        {k.value}
      </div>
      <div className="flex items-center justify-between gap-2">
        {k.trend ? <TrendPill trend={k.trend} /> : <span />}
        {k.hint && (
          <span className="font-mono text-caption text-text-subtle truncate">
            {k.hint}
          </span>
        )}
      </div>
    </>
  );
  if (k.href) {
    return (
      <Link href={k.href} className={base} data-testid={`kpi-${k.label}`}>
        {content}
      </Link>
    );
  }
  return (
    <div className={base} data-testid={`kpi-${k.label}`}>
      {content}
    </div>
  );
}

export function KpiBar({ summary }: { summary: WorkspaceSummaryDto }) {
  const t = useTranslations("cockpit.kpi");
  const { hero, cards } = buildKpis(summary, t);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <HeroCard k={hero} />
      {cards.map((k) => (
        <StatCard key={k.label} k={k} />
      ))}
    </div>
  );
}
