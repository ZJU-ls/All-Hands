import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@/tests/test-utils/i18n-render";
import { ToolCallCard } from "../ToolCallCard";
import type { ToolCall } from "@/lib/protocol";

afterEach(cleanup);

function makeCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "tc_1",
    tool_id: "allhands.meta.list_providers",
    args: {},
    status: "succeeded",
    result: undefined,
    ...overrides,
  };
}

describe("ToolCallCard", () => {
  it("shows the full tool id so meta tools are distinguishable", () => {
    render(<ToolCallCard toolCall={makeCall()} />);
    expect(screen.getByTestId("tool-call-name").textContent).toBe(
      "allhands.meta.list_providers",
    );
  });

  it("renders a compact args summary without expansion", () => {
    render(
      <ToolCallCard
        toolCall={makeCall({
          tool_id: "allhands.meta.dispatch_employee",
          args: { name: "Alice", task: "draw a cat" },
          status: "running",
        })}
      />,
    );
    const summary = screen.getByTestId("tool-call-args-summary");
    expect(summary.textContent).toContain("name=Alice");
    expect(summary.textContent).toContain("task=");
  });

  it("summarizes a list result as N items", () => {
    render(
      <ToolCallCard
        toolCall={makeCall({
          result: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
        })}
      />,
    );
    expect(screen.getByTestId("tool-call-result-summary").textContent).toBe(
      "3 items",
    );
  });

  it("maps status to a compact label + colored text", () => {
    render(<ToolCallCard toolCall={makeCall({ status: "failed" })} />);
    const status = screen.getByTestId("tool-call-status");
    expect(status.textContent).toBe("failed");
    expect(status.className).toContain("text-danger");
  });

  it("hides the args summary when args is empty", () => {
    render(<ToolCallCard toolCall={makeCall({ args: {} })} />);
    expect(screen.queryByTestId("tool-call-args-summary")).toBeNull();
  });

  it("expands to show full JSON args + result on click", () => {
    render(
      <ToolCallCard
        toolCall={makeCall({
          args: { name: "Alice" },
          result: { providers: ["openai", "anthropic"] },
        })}
      />,
    );
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/"name": "Alice"/)).toBeInTheDocument();
    // The full JSON result body includes "anthropic" on its own line;
    // the summary also contains it. At least one occurrence must exist.
    expect(screen.getAllByText(/"anthropic"/).length).toBeGreaterThan(0);
  });

  it("does not surface a result summary while the call is still running", () => {
    render(
      <ToolCallCard
        toolCall={makeCall({
          status: "running",
          args: { name: "A" },
          result: [1, 2, 3],
        })}
      />,
    );
    expect(screen.queryByTestId("tool-call-result-summary")).toBeNull();
  });
});
