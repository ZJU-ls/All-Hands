"use client";

/**
 * ProgressPanel · ADR 0019 C1 + C2 (Round 2 layout)
 *
 * Above InputBar: a strip with 1-2 tabs (Plan / Subagents). Whichever tab
 * is selected expands BELOW the tab strip into the full chat width. Only
 * one tab's body shows at a time so the chat doesn't grow vertically as
 * activity stacks up.
 *
 * Tabs themselves remain visible always (with summary badges) so a
 * collapsed-everything state still tells you "1/4 done · 2 subagents
 * running" at a glance. Tab body collapses by clicking the active tab.
 *
 * Background uses the conversation's surface-2 token (matches the chat
 * area) so the panel reads as a discrete strip, not a floating white card
 * that breaks the page rhythm.
 *
 * State persistence (localStorage):
 *   allhands.progress.activeTab  → "plan" | "subagent" | "" (collapsed)
 *
 * Data sources:
 *   - plan: GET /api/conversations/{id}/plans/latest (debounced refetch
 *     on store activity)
 *   - subagent: derived from messages + streamingMessage tool_calls
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { PlanProgressSection } from "./PlanProgressSection";
import { SubagentProgressSection } from "./SubagentProgressSection";
import { useActiveSubagents, useLatestPlan } from "./progress-hooks";

const STORAGE_KEY = "allhands.progress.activeTab";

type TabId = "plan" | "subagent" | "";

type Props = {
  conversationId: string;
};

export function ProgressPanel({ conversationId }: Props) {
  const t = useTranslations("chat.progressPanel");
  const tPlan = useTranslations("chat.planProgress");
  const plan = useLatestPlan(conversationId);
  const subagents = useActiveSubagents();

  const hasPlan = plan != null && plan.steps.length > 0;
  const hasSubagents = subagents.length > 0;

  const [active, setActive] = useState<TabId>("");

  // Restore persisted tab on mount; default to whichever has data so the
  // panel doesn't open in a confusing collapsed state when content exists.
  useEffect(() => {
    let stored: TabId | null = null;
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      if (v === "plan" || v === "subagent" || v === "") stored = v;
    } catch {
      /* private-browsing fallback */
    }
    if (stored === "plan" && hasPlan) {
      setActive("plan");
    } else if (stored === "subagent" && hasSubagents) {
      setActive("subagent");
    } else if (stored === "") {
      setActive("");
    } else {
      // No prior preference — auto-open whichever tab has content. Plan
      // wins if both since it usually drives subagents.
      setActive(hasPlan ? "plan" : hasSubagents ? "subagent" : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the only tab with data disappears, snap back to that state cleanly.
  useEffect(() => {
    if (active === "plan" && !hasPlan)
      setActive(hasSubagents ? "subagent" : "");
    if (active === "subagent" && !hasSubagents)
      setActive(hasPlan ? "plan" : "");
  }, [active, hasPlan, hasSubagents]);

  if (!hasPlan && !hasSubagents) return null;

  const onTabClick = (tab: Exclude<TabId, "">) => {
    setActive((prev) => {
      const next = prev === tab ? ("" as TabId) : tab;
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* persistence is best-effort */
      }
      return next;
    });
  };

  // Counts shown inline on each tab.
  const planDone = plan?.steps.filter((s) => s.status === "done").length ?? 0;
  const planTotal = plan?.steps.length ?? 0;
  const planRunning =
    plan?.steps.filter((s) => s.status === "running").length ?? 0;
  const subRunning = subagents.filter((s) => s.status === "running").length;
  const subFailed = subagents.filter((s) => s.status === "failed").length;

  // Body comes BEFORE tabs in DOM order — when expanded, content sits ABOVE
  // the tab strip so the input bar (which is anchored below this panel)
  // doesn't jump around as the user toggles. Tab strip stays glued just
  // above the input bar; the body grows upward into the chat scroll area.
  return (
    <div
      data-testid="progress-panel"
      className="bg-bg"
    >
      <div className="mx-auto w-full max-w-6xl px-4 pb-2 pt-2">
        {/* Body · rendered ABOVE tabs so toggling doesn't shove the input. */}
        {active && (
          <div
            data-testid={`progress-body-${active}`}
            className="mb-2 overflow-hidden rounded-xl border border-border/70 bg-surface-2/60 backdrop-blur-sm"
          >
            {active === "plan" && hasPlan && plan && (
              <PlanProgressSection plan={plan} embedded />
            )}
            {active === "subagent" && hasSubagents && (
              <SubagentProgressSection subagents={subagents} embedded />
            )}
          </div>
        )}

        {/* Tab strip · always visible · summary badges still readable when
           collapsed. Background blends with page bg; only the active tab gets
           a subtle primary tint so the active state is unambiguous without
           floating "white card" feel. */}
        <div
          role="tablist"
          aria-label={t("ariaLabel")}
          className="flex items-stretch gap-1.5"
        >
          {hasPlan && (
            <Tab
              id="plan"
              icon="list"
              label={plan?.title ?? tPlan("fallbackTitle")}
              active={active === "plan"}
              onClick={() => onTabClick("plan")}
              bodyAbove
              badge={
                planRunning > 0 ? (
                  <span className="text-warning">
                    <span className="tabular-nums">{planDone}</span>
                    <span className="text-text-subtle">/{planTotal}</span>
                    <span className="ml-1.5">
                      {t("runningSuffix", { n: planRunning })}
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="tabular-nums">{planDone}</span>
                    <span className="text-text-subtle">/{planTotal}</span>
                  </>
                )
              }
            />
          )}
          {hasSubagents && (
            <Tab
              id="subagent"
              icon="users"
              label={t("subagentTab")}
              active={active === "subagent"}
              onClick={() => onTabClick("subagent")}
              bodyAbove
              badge={
                <span
                  className={cn(
                    "tabular-nums",
                    subRunning > 0
                      ? "text-warning"
                      : subFailed > 0
                        ? "text-danger"
                        : "text-text-muted",
                  )}
                >
                  {subagents.length}
                  {subRunning > 0 && (
                    <span className="ml-1.5">
                      {t("runningSuffix", { n: subRunning })}
                    </span>
                  )}
                  {subFailed > 0 && (
                    <span className="ml-1.5 text-danger">
                      {t("failedSuffix", { n: subFailed })}
                    </span>
                  )}
                </span>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Tab({
  id,
  icon,
  label,
  active,
  badge,
  onClick,
  bodyAbove = false,
}: {
  id: string;
  icon: string;
  label: string;
  active: boolean;
  badge: React.ReactNode;
  onClick: () => void;
  bodyAbove?: boolean;
}) {
  // Chevron points TOWARD the body. With bodyAbove, the body is above the
  // tab when active → chevron-down means "click to dismiss the body up
  // there", chevron-up means "click to expand body upward".
  const chevron = active
    ? bodyAbove
      ? "chevron-down"
      : "chevron-up"
    : bodyAbove
      ? "chevron-up"
      : "chevron-down";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`progress-tab-${id}`}
      onClick={onClick}
      className={cn(
        "group flex flex-1 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-[background-color,border-color,color] duration-fast",
        active
          ? "border-primary/40 bg-primary-muted/70 text-text"
          : "border-border/70 bg-bg text-text-muted hover:border-border-strong hover:bg-surface-2/70 hover:text-text",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded-md transition-[background-color,color]",
          active ? "bg-primary text-primary-fg" : "bg-primary-muted/60 text-primary",
        )}
      >
        <Icon name={icon as never} size={11} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
        {label}
      </span>
      <span className="shrink-0 font-mono text-[11px]">{badge}</span>
      <Icon
        name={chevron}
        size={11}
        className="shrink-0 text-text-subtle"
      />
    </button>
  );
}
