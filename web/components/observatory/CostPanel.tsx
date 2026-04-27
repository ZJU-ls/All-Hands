"use client";

/**
 * CostPanel · Helicone-inspired cost dashboard.
 *
 * Pulls a cost time-series and renders:
 *   - 24h total ($)
 *   - Per-hour avg + projected daily / monthly
 *   - Top-3 cost drivers (employees, models)
 *   - Inline sparkline
 *
 * The endpoint is /api/observatory/series?metric=cost so the data is the
 * same the MetricDrawer would see when opened — keeps numbers consistent
 * across surfaces.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import {
  fetchMetricSeries,
  type ObservatoryEmployeeBreakdownDto,
  type ObservatoryModelBreakdownDto,
  type TimeSeriesDto,
} from "@/lib/observatory-api";

export type CostPanelProps = {
  totalUsd: number;
  byEmployee: ObservatoryEmployeeBreakdownDto[];
  byModel: ObservatoryModelBreakdownDto[];
  onClickDrillDown?: () => void;
};

export function CostPanel({
  totalUsd,
  byEmployee,
  byModel,
  onClickDrillDown,
}: CostPanelProps) {
  const t = useTranslations("pages.observatory.costPanel");
  const [series, setSeries] = useState<TimeSeriesDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMetricSeries({ metric: "cost", bucket: "1h" })
      .then((s) => {
        if (!cancelled) setSeries(s);
      })
      .catch(() => {
        if (!cancelled) setSeries(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Projection: average hourly cost over the window × 24 (daily) or × 720 (monthly).
  // Underestimates if traffic is bursty; overestimates if the window includes idle hours.
  // Honest enough for a back-of-envelope card.
  const hourlyAvg =
    series && series.points.length > 0
      ? series.points.reduce((a, p) => a + p.value, 0) / series.points.length
      : 0;
  const projectedDaily = hourlyAvg * 24;
  const projectedMonthly = projectedDaily * 30;

  const topEmployees = byEmployee
    .filter((e) => e.estimated_cost_usd > 0)
    .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
    .slice(0, 3);
  const topModels = byModel
    .filter((m) => m.estimated_cost_usd > 0)
    .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
    .slice(0, 3);

  return (
    <div className="rounded-xl bg-surface border border-border shadow-soft-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 h-11 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-primary/10 text-primary grid place-items-center">
            <Icon name="database" size={13} />
          </div>
          <span className="text-[13px] font-semibold text-text">
            {t("title")}
          </span>
        </div>
        {onClickDrillDown ? (
          <button
            type="button"
            onClick={onClickDrillDown}
            className="text-[11px] font-mono text-primary hover:underline"
          >
            {t("seeChart")} →
          </button>
        ) : null}
      </div>
      <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat
          label={t("today")}
          value={`$${totalUsd.toFixed(4)}`}
          tone="primary"
        />
        <Stat
          label={t("dailyProjection")}
          value={`$${projectedDaily.toFixed(2)}`}
          hint={t("hint24h")}
        />
        <Stat
          label={t("monthlyProjection")}
          value={`$${projectedMonthly.toFixed(2)}`}
          hint={t("hintMonthly")}
        />
      </div>
      <div className="px-5 pb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Mini
          title={t("topEmployees")}
          rows={topEmployees.map((e) => ({
            label: e.employee_name,
            value: `$${e.estimated_cost_usd.toFixed(4)}`,
          }))}
          emptyText={t("noData")}
        />
        <Mini
          title={t("topModels")}
          rows={topModels.map((m) => ({
            label: m.model_ref,
            value: `$${m.estimated_cost_usd.toFixed(4)}`,
          }))}
          emptyText={t("noData")}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "primary";
  hint?: string;
}) {
  return (
    <div className="rounded-lg bg-surface-2/40 px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-[18px] font-semibold tabular-nums ${
          tone === "primary" ? "text-primary" : "text-text"
        }`}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-text-subtle">{hint}</div>
      ) : null}
    </div>
  );
}

function Mini({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: { label: string; value: string }[];
  emptyText: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle mb-2">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-text-muted">{emptyText}</div>
      ) : (
        <ul className="space-y-1">
          {rows.map((r, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-[12px] text-text truncate">{r.label}</span>
              <span className="font-mono text-[11.5px] text-text-muted tabular-nums shrink-0">
                {r.value}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
