"use client";

/**
 * ProgressPanel · ADR 0019 C1 + C2
 *
 * Sticky panel above the InputBar that surfaces the conversation's
 * current plan progress and any active sub-agents. Two independently
 * collapsible sections; remembers expand/collapse state per section
 * across conversations via localStorage. Whole panel hides itself when
 * neither section has content (simple chat scenarios stay clean).
 *
 * Data sources (per design doc):
 *   - plan: GET /api/conversations/{id}/plans/latest, refetched on
 *     ToolMessageCommitted with plan_id (debounced)
 *   - subagent: derived from store (running dispatch_employee /
 *     spawn_subagent tool_calls) — zero backend overhead, real-time
 *     via stream
 */

import { PlanProgressSection } from "./PlanProgressSection";
import { SubagentProgressSection } from "./SubagentProgressSection";
import { useActiveSubagents, useLatestPlan } from "./progress-hooks";

type Props = {
  conversationId: string;
};

export function ProgressPanel({ conversationId }: Props) {
  const plan = useLatestPlan(conversationId);
  const subagents = useActiveSubagents();

  const hasPlan = plan != null && plan.steps.length > 0;
  const hasSubagents = subagents.length > 0;

  // Whole-panel hide when there's nothing to show — keeps simple
  // conversations from accumulating empty chrome above the input.
  if (!hasPlan && !hasSubagents) return null;

  return (
    <div
      data-testid="progress-panel"
      className="border-t border-border bg-surface"
    >
      {hasPlan && <PlanProgressSection plan={plan!} />}
      {hasSubagents && <SubagentProgressSection subagents={subagents} />}
    </div>
  );
}
