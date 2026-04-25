/**
 * ConversationHeader unit test — the chat header is intentionally lean
 * (employee name + optional title + model chip). Capability badges + the
 * lead/emp prefix got pushed to /employees/[id] because the chat surface
 * should only carry what changes per-conversation.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@/tests/test-utils/i18n-render";
import { ConversationHeader } from "@/components/chat/ConversationHeader";

afterEach(cleanup);

describe("ConversationHeader", () => {
  it("renders the employee name as a link to their detail page", () => {
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
    const link = screen.getByRole("link", { name: /查看员工 Lead 主页/ });
    expect(link.getAttribute("href")).toBe("/employees/emp_lead");
    expect(screen.getByText("Lead")).toBeDefined();
  });

  it("does not render capability badges or lead/emp prefix (moved to employee page)", () => {
    render(
      <ConversationHeader
        employee={{
          id: "emp_writer",
          name: "Writer",
          description: "writes posts",
          tool_ids: ["allhands.meta.plan_create"],
          is_lead_agent: true,
        }}
      />,
    );
    expect(screen.queryByText("全能")).toBeNull();
    expect(screen.queryByText("会做计划")).toBeNull();
    expect(screen.queryByText("emp")).toBeNull();
    expect(screen.queryByText("lead")).toBeNull();
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

  it("renders the effective-model chip when a model ref is passed", () => {
    render(
      <ConversationHeader
        employee={{
          id: "emp_writer",
          name: "Writer",
          description: "",
          tool_ids: [],
        }}
        effectiveModelRef="openai/gpt-5"
        isOverridden
      />,
    );
    const chip = screen.getByTestId("conversation-header-model-badge");
    expect(chip.getAttribute("data-overridden")).toBe("true");
    expect(chip.textContent).toContain("gpt-5");
  });
});
