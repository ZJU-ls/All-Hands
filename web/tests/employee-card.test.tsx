/**
 * EmployeeCard render component tests — I-0008.
 *
 * Shape + contract: `EmployeeCard` is the registry target for the
 * `create_employee` meta tool render envelope. Without it the chat surface
 * can't reflect a newly-built employee inline (N1 breach).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EmployeeCard } from "@/components/render/EmployeeCard";

afterEach(cleanup);

const NO_INTERACTIONS: never[] = [];

describe("EmployeeCard", () => {
  it("renders name + role + system_prompt_preview + meta line", () => {
    render(
      <EmployeeCard
        props={{
          employee_id: "emp-01",
          name: "Researcher",
          role: "Desk research specialist",
          system_prompt_preview: "你是一名擅长桌面研究的助手 · 必须引用来源。",
          skill_count: 2,
          tool_count: 7,
          model: { provider: "openai", name: "gpt-4o-mini" },
          status: "active",
        }}
        interactions={NO_INTERACTIONS}
      />,
    );

    expect(screen.getByText("Researcher")).toBeDefined();
    expect(screen.getByText("Desk research specialist")).toBeDefined();
    expect(screen.getByText(/桌面研究/)).toBeDefined();
    expect(screen.getByText("skills")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("tools")).toBeDefined();
    expect(screen.getByText("7")).toBeDefined();
    expect(screen.getByText("openai/gpt-4o-mini")).toBeDefined();
  });

  it("uses status=draft by default and hides the active accent bar", () => {
    const { container } = render(
      <EmployeeCard
        props={{ employee_id: "emp-02", name: "Writer" }}
        interactions={NO_INTERACTIONS}
      />,
    );
    const card = container.querySelector("[data-component='EmployeeCard']");
    expect(card?.getAttribute("data-status")).toBe("draft");
    expect(container.querySelector(".bg-primary")).toBeNull();
  });

  it("renders the 2px activation bar when status=active", () => {
    const { container } = render(
      <EmployeeCard
        props={{ employee_id: "emp-03", name: "Lead", status: "active" }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(container.querySelector(".bg-primary")).not.toBeNull();
  });

  it("derives avatar initial from the name when avatar_initial is absent", () => {
    render(
      <EmployeeCard
        props={{ employee_id: "emp-04", name: "alice" }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("A")).toBeDefined();
  });

  it("honours an explicit avatar_initial override", () => {
    render(
      <EmployeeCard
        props={{
          employee_id: "emp-05",
          name: "ignored",
          avatar_initial: "Z",
        }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("Z")).toBeDefined();
  });

  it("tolerates minimal payloads (just id + name)", () => {
    render(
      <EmployeeCard
        props={{ employee_id: "emp-06", name: "Minimal" }}
        interactions={NO_INTERACTIONS}
      />,
    );
    expect(screen.getByText("Minimal")).toBeDefined();
  });
});
