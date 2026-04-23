"use client";

/**
 * DrawerRail · 44px vertical rail on the cockpit's right edge.
 *
 * Owns 3 drawer slots (Health / Budget / Convs) + a read-only link to
 * the Observatory. The drawer module itself is lazy-loaded via
 * `next/dynamic` and only mounts once the user opens a drawer for the
 * first time — keeps the cockpit route's dev cold-compile graph lean
 * per L08.
 *
 * Each rail button shows a small status badge (dot / count) so the user
 * can glance the rail and decide whether to expand. No hover scale, no
 * glow, no shadow — the affordance is only the border intensity + a 2px
 * primary activation bar on the left edge of the active button (allowed
 * `ah-bar-in` keyframe).
 */

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import {
  ChatIcon,
  ObservatoryIcon,
  StockIcon,
  type IconProps,
} from "@/components/icons";
import type { WorkspaceSummaryDto } from "@/lib/cockpit-api";
import type { DrawerPanel } from "./CockpitDrawer";

const CockpitDrawer = dynamic(
  () => import("./CockpitDrawer").then((m) => m.CockpitDrawer),
  { ssr: false },
);

// Shield-shape fallback for "Health" since we don't ship a shield icon.
// Keeps within the custom icon contract: 2px stroke, currentColor, 24x24.
function HealthRailIcon(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size ?? 20}
      height={props.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={props.strokeWidth ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={props.className}
    >
      <path d="M12 3 4 6v6c0 4.5 3.5 8 8 9 4.5-1 8-4.5 8-9V6l-8-3Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

type RailItem = {
  panel: DrawerPanel;
  label: string;
  Icon: (p: IconProps) => JSX.Element;
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
  const [open, setOpen] = useState<DrawerPanel | null>(null);
  const [mountedOnce, setMountedOnce] = useState(false);

  const toggle = (p: DrawerPanel) => {
    setMountedOnce(true);
    setOpen((cur) => (cur === p ? null : p));
  };

  const items: RailItem[] = [
    {
      panel: "health",
      label: "健康",
      Icon: HealthRailIcon,
      badge: countBadHealth(summary),
      tone: countBadHealth(summary) > 0 ? "warn" : undefined,
    },
    {
      panel: "budget",
      label: "消耗",
      Icon: StockIcon,
      tone: budgetTone(summary),
    },
    {
      panel: "convs",
      label: "对话",
      Icon: ChatIcon,
      badge: summary.recent_conversations.length,
    },
  ];

  return (
    <>
      <aside
        className="relative z-30 shrink-0 w-11 border-l border-border bg-surface flex flex-col"
        data-testid="cockpit-drawer-rail"
        aria-label="Secondary panels"
      >
        <ul className="flex-1 py-2 flex flex-col items-center gap-1">
          {items.map((it) => {
            const active = open === it.panel;
            const badgeColor =
              it.tone === "danger"
                ? "bg-danger text-bg"
                : it.tone === "warn"
                  ? "bg-warning text-bg"
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
                  className={`relative inline-flex h-9 w-9 items-center justify-center rounded border transition-colors duration-base ${
                    active
                      ? "border-border-strong bg-surface-2 text-text"
                      : "border-transparent text-text-muted hover:text-text hover:bg-surface-2"
                  }`}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[-2px] top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary"
                      style={{
                        animation: "ah-bar-in 180ms var(--ease-out) both",
                        transformOrigin: "center",
                      }}
                    />
                  )}
                  <it.Icon size={16} />
                  {it.badge !== undefined && it.badge > 0 && (
                    <span
                      className={`absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-1 rounded-full font-mono text-[9px] font-semibold tabular-nums leading-[14px] text-center ${badgeColor}`}
                      aria-hidden="true"
                    >
                      {it.badge > 99 ? "99+" : it.badge}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          <li className="mt-1 w-6 border-t border-border" aria-hidden="true" />
          <li>
            <Link
              href="/observatory"
              title="观测中心"
              aria-label="观测中心"
              className="inline-flex h-9 w-9 items-center justify-center rounded border border-transparent text-text-muted hover:text-text hover:bg-surface-2 transition-colors duration-base"
              data-testid="rail-observatory"
            >
              <ObservatoryIcon size={16} />
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
