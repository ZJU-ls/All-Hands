import { describe, expect, it } from "vitest";

import { deriveProfile } from "../employee-profile";

describe("deriveProfile", () => {
  it("returns [react] for a plain employee", () => {
    expect(
      deriveProfile({ tool_ids: ["allhands.builtin.fetch_url"] }),
    ).toEqual(["react"]);
  });

  it("adds planner when any plan_* tool is mounted", () => {
    expect(
      deriveProfile({
        tool_ids: ["allhands.builtin.fetch_url", "allhands.meta.plan_create"],
      }),
    ).toEqual(["react", "planner"]);
  });

  it("adds coordinator when dispatch_employee is mounted", () => {
    expect(
      deriveProfile({
        tool_ids: ["allhands.meta.dispatch_employee", "allhands.meta.list_employees"],
      }),
    ).toEqual(["react", "coordinator"]);
  });

  it("adds coordinator for Lead agents even without dispatch in tool_ids", () => {
    const badges = deriveProfile({ tool_ids: [], is_lead_agent: true });
    expect(badges).toContain("coordinator");
  });

  it("stacks planner + coordinator for a sub-lead", () => {
    const badges = deriveProfile({
      tool_ids: [
        "allhands.meta.plan_create",
        "allhands.meta.dispatch_employee",
        "allhands.meta.list_employees",
        "allhands.meta.get_employee_detail",
      ],
    });
    expect(badges).toEqual(["react", "planner", "coordinator"]);
  });
});
