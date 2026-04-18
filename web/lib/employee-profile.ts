/**
 * Employee Profile badges (agent-design § 4).
 *
 * There is **no** `mode` field on Employee — differences are expressed via
 * `tool_ids[]`. This utility derives human-friendly capability badges from
 * the mounted tools, for use in Employees UI / Cockpit etc.
 *
 * All employees are React agents (`react`). Additional badges:
 *
 * - `planner`     → has any `allhands.meta.plan_*` tool
 * - `coordinator` → has `allhands.meta.dispatch_employee`
 */

export type EmployeeBadge = "react" | "planner" | "coordinator";

export type EmployeeForBadges = {
  tool_ids: string[];
  is_lead_agent?: boolean;
};

const DISPATCH_TOOL_ID = "allhands.meta.dispatch_employee";
const PLAN_TOOL_PREFIX = "allhands.meta.plan_";

export function deriveProfile(employee: EmployeeForBadges): EmployeeBadge[] {
  const badges: EmployeeBadge[] = ["react"];
  if (employee.tool_ids.some((t) => t.startsWith(PLAN_TOOL_PREFIX))) {
    badges.push("planner");
  }
  if (employee.tool_ids.includes(DISPATCH_TOOL_ID) || employee.is_lead_agent) {
    badges.push("coordinator");
  }
  return badges;
}

export const BADGE_LABEL: Record<EmployeeBadge, string> = {
  react: "可执行",
  planner: "会做计划",
  coordinator: "能带团队",
};
