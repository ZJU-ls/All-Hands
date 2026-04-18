/**
 * ConversationHeader unit test — spec 2026-04-18-employee-chat.md § 9.
 *
 * Goal: render different headers based on employee identity without any
 * mode/flag beyond what's already on the Employee payload (react vs lead,
 * presence of dispatch/plan tools to derive badges).
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ConversationHeader } from "@/components/chat/ConversationHeader";

afterEach(cleanup);

describe("ConversationHeader", () => {
  it("shows 全能 badge for lead agent", () => {
    render(
      <ConversationHeader
        employee={{
          id: "emp_lead",
          name: "Lead",
          description: "",
          tool_ids: [],
          is_lead_agent: true,
        }}
      />,
    );
    expect(screen.getByText("Lead")).toBeDefined();
    expect(screen.getByText("全能")).toBeDefined();
    expect(screen.getByText("lead")).toBeDefined();
  });

  it("derives planner badge from plan_* tools", () => {
    render(
      <ConversationHeader
        employee={{
          id: "emp_writer",
          name: "Writer",
          description: "writes posts",
          tool_ids: ["allhands.meta.plan_create"],
        }}
      />,
    );
    expect(screen.getByText("Writer")).toBeDefined();
    expect(screen.getByText("emp")).toBeDefined();
    expect(screen.getByText("会做计划")).toBeDefined();
  });

  it("falls back to placeholder when no employee", () => {
    render(<ConversationHeader employee={null} />);
    expect(screen.getByText("加载中…")).toBeDefined();
  });

  it("shows conversation title when provided", () => {
    render(
      <ConversationHeader
        employee={{
          id: "emp_writer",
          name: "Writer",
          description: "",
          tool_ids: [],
        }}
        conversationTitle="Draft Q4 post"
      />,
    );
    expect(screen.getByText("Draft Q4 post")).toBeDefined();
  });
});
