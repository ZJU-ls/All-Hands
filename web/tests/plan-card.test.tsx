/**
 * PlanCard render component tests — I-0022 Phase 3.
 *
 * Shape + contract: `PlanCard` is the registry target for the
 * `render_plan` render tool (spec § 6.1). It surfaces a human-approval
 * contract before any side-effecting action runs.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PlanCard } from "@/components/render/PlanCard";

afterEach(cleanup);

const APPROVE_REJECT_EDIT = [
  {
    kind: "button" as const,
    label: "Approve",
    action: "invoke_tool",
    payload: { tool: "allhands.builtin.render_plan", args: { plan_id: "p1", decision: "approve" } },
  },
  {
    kind: "button" as const,
    label: "Reject",
    action: "invoke_tool",
    payload: { tool: "allhands.builtin.render_plan", args: { plan_id: "p1", decision: "reject" } },
  },
  {
    kind: "button" as const,
    label: "Edit",
    action: "send_message",
    payload: { text: "Please revise plan p1: " },
  },
];

describe("PlanCard", () => {
  it("renders title + plan_id + all steps with pending glyph", () => {
    render(
      <PlanCard
        props={{
          plan_id: "plan-2026-Q2",
          title: "Q2 market research",
          steps: [
            { id: "s1", title: "Crawl competitor pages", body: "scrape top 10", status: "pending" },
            { id: "s2", title: "Summarize findings", status: "pending" },
          ],
        }}
        interactions={APPROVE_REJECT_EDIT}
      />,
    );
    expect(screen.getByText("Q2 market research")).toBeDefined();
    expect(screen.getByText("plan-2026-Q2")).toBeDefined();
    expect(screen.getByText("Crawl competitor pages")).toBeDefined();
    expect(screen.getByText("scrape top 10")).toBeDefined();
  });

  it("shows Approve / Reject / Edit buttons while pending", () => {
    const { container } = render(
      <PlanCard
        props={{
          plan_id: "p1",
          title: "t",
          steps: [{ id: "s1", title: "step", status: "pending" }],
        }}
        interactions={APPROVE_REJECT_EDIT}
      />,
    );
    expect(screen.getByText("Approve")).toBeDefined();
    expect(screen.getByText("Reject")).toBeDefined();
    expect(screen.getByText("Edit")).toBeDefined();
    const card = container.querySelector("[data-component='PlanCard']");
    expect(card?.getAttribute("data-status")).toBe("pending");
  });

  it("hides the buttons once every step is approved", () => {
    render(
      <PlanCard
        props={{
          plan_id: "p1",
          title: "t",
          steps: [
            { id: "s1", title: "step 1", status: "approved" },
            { id: "s2", title: "step 2", status: "approved" },
          ],
        }}
        interactions={APPROVE_REJECT_EDIT}
      />,
    );
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Reject")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
  });

  it("flags the card as rejected when any step is rejected", () => {
    const { container } = render(
      <PlanCard
        props={{
          plan_id: "p1",
          title: "t",
          steps: [
            { id: "s1", title: "ok", status: "approved" },
            { id: "s2", title: "nope", status: "rejected" },
          ],
        }}
        interactions={APPROVE_REJECT_EDIT}
      />,
    );
    const card = container.querySelector("[data-component='PlanCard']");
    expect(card?.getAttribute("data-status")).toBe("rejected");
  });

  it("renders a placeholder when steps is empty", () => {
    render(
      <PlanCard
        props={{ plan_id: "p1", title: "Empty plan", steps: [] }}
        interactions={APPROVE_REJECT_EDIT}
      />,
    );
    expect(screen.getByText(/no steps/)).toBeDefined();
  });
});
