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

  return (
    <div
      data-testid="progress-panel"
      className="border-t border-border bg-surface-2"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-2">
        {/* Tab bar — always visible · click to expand / collapse below */}
        <div
          role="tablist"
          aria-label="agent progress"
          className="flex items-stretch gap-1.5"
        >
          {hasPlan && (
            <Tab
              id="plan"
              icon="list"
              label={plan?.title ?? "计划"}
              active={active === "plan"}
              onClick={() => onTabClick("plan")}
              badge={
                planRunning > 0 ? (
                  <span className="text-warning">
                    <span className="tabular-nums">{planDone}</span>
                    <span className="text-text-subtle">/{planTotal}</span>
                    <span className="ml-1.5">· {planRunning} 进行中</span>
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
              label="子代理"
              active={active === "subagent"}
              onClick={() => onTabClick("subagent")}
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
                    <span className="ml-1.5">· {subRunning} 进行中</span>
                  )}
                  {subFailed > 0 && (
                    <span className="ml-1.5 text-danger">
                      · {subFailed} 失败
                    </span>
                  )}
                </span>
              }
            />
          )}
        </div>

        {/* Body — full chat width when expanded · matching surface tone */}
        {active && (
          <div
            data-testid={`progress-body-${active}`}
            className="mt-2 overflow-hidden rounded-xl border border-border bg-surface"
          >
            {active === "plan" && hasPlan && plan && (
              <PlanProgressSection plan={plan} embedded />
            )}
            {active === "subagent" && hasSubagents && (
              <SubagentProgressSection subagents={subagents} embedded />
            )}
          </div>
        )}
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
}: {
  id: string;
  icon: string;
  label: string;
  active: boolean;
  badge: React.ReactNode;
  onClick: () => void;
}) {
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
          ? "border-primary/30 bg-primary-muted text-text"
          : "border-border bg-surface text-text hover:border-border-strong hover:bg-surface-3",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded-md transition-[background-color,color]",
          active ? "bg-primary text-primary-fg" : "bg-primary-muted text-primary",
        )}
      >
        <Icon name={icon as never} size={11} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
        {label}
      </span>
      <span className="shrink-0 font-mono text-[11px]">{badge}</span>
      <Icon
        name={active ? "chevron-up" : "chevron-down"}
        size={11}
        className="shrink-0 text-text-subtle"
      />
    </button>
  );
}
