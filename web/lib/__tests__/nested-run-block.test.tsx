/**
 * NestedRunBlock unit test — spec 2026-04-18-employee-chat.md § 2.3 / § 5.3.
 *
 * Dispatch_employee sub-runs are rendered as an indented, collapsible block.
 * Status is color-coded via tokens (no raw hex / no Tailwind color classes).
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { NestedRunBlock } from "@/components/chat/NestedRunBlock";

afterEach(cleanup);

describe("NestedRunBlock", () => {
  it("renders employee name + status label", () => {
    render(
      <NestedRunBlock
        runId="run_x"
        parentRunId="run_p"
        employeeName="Writer"
        status="running"
      >
        <p>child</p>
      </NestedRunBlock>,
    );
    expect(screen.getByText("Writer")).toBeDefined();
    expect(screen.getByText("运行中")).toBeDefined();
  });

  it("collapses children by default and expands on click", () => {
    render(
      <NestedRunBlock
        runId="run_x"
        parentRunId={null}
        employeeName="Writer"
        status="done"
      >
        <p>hidden-text-abc</p>
      </NestedRunBlock>,
    );
    expect(screen.queryByText("hidden-text-abc")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("hidden-text-abc")).toBeDefined();
  });

  it("renders all four status labels", () => {
    for (const [status, label] of [
      ["running", "运行中"],
      ["done", "已完成"],
      ["error", "失败"],
      ["unknown", "—"],
    ] as const) {
      const { unmount } = render(
        <NestedRunBlock
          runId="r"
          parentRunId={null}
          employeeName="X"
          status={status}
        />,
      );
      expect(screen.getByText(label)).toBeDefined();
      unmount();
    }
  });
});
