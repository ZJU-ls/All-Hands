import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@/tests/test-utils/i18n-render";
import type { ToolCall } from "@/lib/protocol";
import { SystemToolLine } from "../SystemToolLine";

afterEach(cleanup);

function mkCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "tc_1",
    tool_id: "allhands.meta.list_providers",
    args: {},
    status: "succeeded",
    result: { providers: [{}, {}, {}], count: 3 },
    ...overrides,
  } as ToolCall;
}

describe("SystemToolLine", () => {
  it("renders short tool name + count summary", () => {
    render(<SystemToolLine toolCall={mkCall()} />);
    const el = screen.getByTestId("system-tool-line");
    expect(el).toHaveAttribute("data-status", "succeeded");
    expect(el.textContent).toContain("list_providers");
    expect(screen.getByTestId("system-tool-summary").textContent).toBe("3 项");
  });

  it("prefers an explicit list field when count is missing", () => {
    const tc = mkCall({
      tool_id: "allhands.meta.list_skills",
      result: { skills: [{}, {}] },
    });
    render(<SystemToolLine toolCall={tc} />);
    expect(screen.getByTestId("system-tool-summary").textContent).toBe("2 项");
  });

  it("falls back to first key=value for unknown result shapes", () => {
    const tc = mkCall({
      tool_id: "allhands.meta.get_provider",
      result: { provider: { id: "p1", name: "CodingPlan" } },
    });
    render(<SystemToolLine toolCall={tc} />);
    expect(screen.getByTestId("system-tool-summary").textContent).toMatch(
      /provider=/,
    );
  });

  it("shows 运行中 with a pulsing dot while running", () => {
    render(<SystemToolLine toolCall={mkCall({ status: "running", result: undefined })} />);
    const el = screen.getByTestId("system-tool-line");
    expect(el).toHaveAttribute("data-status", "running");
    expect(screen.getByTestId("system-tool-summary").textContent).toBe("运行中");
  });

  it("shows the error message when failed", () => {
    const tc = mkCall({
      status: "failed",
      result: undefined,
      error: "database locked",
    });
    render(<SystemToolLine toolCall={tc} />);
    const summary = screen.getByTestId("system-tool-summary");
    expect(summary.textContent).toContain("database locked");
    expect(summary.className).toMatch(/text-danger/);
  });

  it("is non-interactive (no button, no role=button)", () => {
    render(<SystemToolLine toolCall={mkCall()} />);
    // P13: system tools are visualised, not drilled. The transcript should
    // never invite "click me" on our own plumbing.
    expect(screen.queryByRole("button")).toBeNull();
    const el = screen.getByTestId("system-tool-line");
    expect(el.tagName).toBe("DIV");
  });
});
