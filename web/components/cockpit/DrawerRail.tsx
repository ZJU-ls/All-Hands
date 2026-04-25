"use client";

/**
 * DrawerRail · 44px vertical rail on the cockpit's right edge (V2 Azure Live).
 *
 * Restyle: rail buttons are rounded-lg pill-tiles with soft shadows on
 * active state (no more flat borders). Active tile keeps the left 2px
 * primary activation bar (ADR 0016 §D2 sidebar language). All icons go
 * through `<Icon>` — the old custom ChatIcon / StockIcon / HealthRailIcon
 * references are swapped for lucide glyphs per ADR 0016 §D1 ("business
 * icons must go through <Icon>").
 *
 * Lazy-drawer contract (L08) + data-testid shape unchanged.
 */

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/ui/icon";
import type { WorkspaceSummaryDto } from "@/lib/cockpit-api";
import type { DrawerPanel } from "./CockpitDrawer";

const CockpitDrawer = dynamic(
  () => import("./CockpitDrawer").then((m) => m.CockpitDrawer),
  { ssr: false },
);

type RailItem = {
  panel: DrawerPanel;
  label: string;
  icon: IconName;
  /** Count of attention-worthy things this drawer would surface. */
  badge?: number;
  tone?: "warn" | "danger";
};

function countBadHealth(summary: WorkspaceSummaryDto): number {
  const h = summary.health;
  return [h.gateway, h.mcp_servers, h.langfuse, h.db, h.triggers].filter(
    (c) => c.status !== "ok",
  ).length;
}

function budgetTone(summary: WorkspaceSummaryDto): "warn" | undefined {
  // Warning threshold is intentionally soft — $50/24h is already meaningful
  // in a solo-ops workspace. Tweak later if we ship budget caps.
  return summary.estimated_cost_today_usd >= 50 ? "warn" : undefined;
}

export function DrawerRail({ summary }: { summary: WorkspaceSummaryDto }) {
  const t = useTranslations("cockpit.drawerRail");
  const [open, setOpen] = useState<DrawerPanel | null>(null);
  const [mountedOnce, setMountedOnce] = useState(false);

  const toggle = (p: DrawerPanel) => {
    setMountedOnce(true);
    setOpen((cur) => (cur === p ? null : p));
  };

  const items: RailItem[] = [
    {
      panel: "health",
      label: t("health"),
      icon: "shield-check",
      badge: countBadHealth(summary),
      tone: countBadHealth(summary) > 0 ? "warn" : undefined,
    },
    {
      panel: "budget",
      label: t("budget"),
      icon: "database",
      tone: budgetTone(summary),
    },
    {
      panel: "convs",
      label: t("convs"),
      icon: "message-square",
      badge: summary.recent_conversations.length,
    },
  ];

  return (
    <>
      <aside
        className="relative z-30 shrink-0 w-11 border-l border-border bg-surface flex flex-col"
        data-testid="cockpit-drawer-rail"
        aria-label={t("secondaryAria")}
      >
        <ul className="flex-1 py-2 flex flex-col items-center gap-1.5">
          {items.map((it) => {
            const active = open === it.panel;
            const badgeColor =
              it.tone === "danger"
                ? "bg-danger text-primary-fg"
                : it.tone === "warn"
                  ? "bg-warning text-primary-fg"
                  : "bg-primary text-primary-fg";
            return (
              <li key={it.panel}>
                <button
                  type="button"
                  onClick={() => toggle(it.panel)}
                  aria-pressed={active}
                  aria-label={it.label}
                  title={it.label}
                  data-testid={`rail-${it.panel}`}
                  className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition duration-base ${
                    active
                      ? "bg-primary-muted text-primary shadow-soft-sm"
                      : "text-text-muted hover:text-text hover:bg-surface-2"
                  }`}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[-4px] top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary"
                      style={{
                        animation: "ah-bar-in 180ms var(--ease-out) both",
                        transformOrigin: "center",
                      }}
                    />
                  )}
                  <Icon name={it.icon} size={16} />
                  {it.badge !== undefined && it.badge > 0 && (
                    <span
                      className={`absolute top-0 right-0 min-w-[14px] h-[14px] px-1 rounded-full font-mono text-[9px] font-semibold tabular-nums leading-[14px] text-center shadow-soft-sm ${badgeColor}`}
                      aria-hidden="true"
                    >
                      {it.badge > 99 ? "99+" : it.badge}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          <li
            className="mt-1 w-6 border-t border-border"
            aria-hidden="true"
          />
          <li>
            <Link
              href="/observatory"
              title={t("observatory")}
              aria-label={t("observatory")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition duration-base hover:text-text hover:bg-surface-2"
              data-testid="rail-observatory"
            >
              <Icon name="activity" size={16} />
            </Link>
          </li>
        </ul>
        <div className="border-t border-border py-2 flex flex-col items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-text-subtle">
          <span>CPT</span>
          <span>v0</span>
        </div>
      </aside>
      {mountedOnce && open !== null && (
        <CockpitDrawer
          panel={open}
          summary={summary}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
