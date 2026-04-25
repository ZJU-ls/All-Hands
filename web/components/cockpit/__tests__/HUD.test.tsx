/**
 * HUD · top status strip — unit contract.
 *
 * Asserts:
 *   1. Shows `LIVE` status dot + wall-clock when the workspace is
 *      streaming + un-paused.
 *   2. Flips to `已暂停` + shows the pause reason; swaps 急停 button
 *      for 恢复运行.
 *   3. Pending-attention badges (tasks_needs_user / confirmations_pending)
 *      render as tokenized warning chips with router-visible links.
 *   4. 急停 button click triggers onPauseRequest (not immediate pause —
 *      the parent owns the ConfirmDialog).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/tests/test-utils/i18n-render";
import { HUD } from "../HUD";
import type { WorkspaceSummaryDto } from "@/lib/cockpit-api";

function makeSummary(overrides: Partial<WorkspaceSummaryDto> = {}): WorkspaceSummaryDto {
  return {
    employees_total: 2,
    runs_active: 0,
    conversations_today: 0,
    artifacts_total: 0,
    artifacts_this_week_delta: 0,
    triggers_active: 0,
    tasks_active: 0,
    tasks_needs_user: 0,
    tokens_today_total: 0,
    tokens_today_prompt: 0,
    tokens_today_completion: 0,
    estimated_cost_today_usd: 0,
    health: {
      gateway: { name: "gateway", status: "ok", detail: null },
      mcp_servers: { name: "mcp", status: "ok", detail: null },
      langfuse: { name: "langfuse", status: "ok", detail: null },
      db: { name: "db", status: "ok", detail: null },
      triggers: { name: "triggers", status: "ok", detail: null },
    },
    confirmations_pending: 0,
    runs_failing_recently: 0,
    recent_events: [],
    active_runs: [],
    recent_conversations: [],
    paused: false,
    paused_reason: null,
    paused_at: null,
    ...overrides,
  };
}

describe("HUD", () => {
  it("shows LIVE dot + 急停 when connection is open and not paused", () => {
    const onPauseRequest = vi.fn();
    render(
      <HUD
        summary={makeSummary()}
        connection="open"
        onPauseRequest={onPauseRequest}
        onResume={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByTestId("cockpit-hud")).toBeDefined();
    expect(screen.getByText("LIVE")).toBeDefined();
    const pauseBtn = screen.getByTestId("hud-pause");
    expect(pauseBtn).toBeDefined();
    fireEvent.click(pauseBtn);
    expect(onPauseRequest).toHaveBeenCalledOnce();
    // When un-paused the resume affordance must be absent.
    expect(screen.queryByTestId("hud-resume")).toBeNull();
  });

  it("flips to 已暂停 + 恢复运行 when workspace is paused, shows reason", () => {
    render(
      <HUD
        summary={makeSummary({ paused: true, paused_reason: "维护中" })}
        connection="open"
        onPauseRequest={vi.fn()}
        onResume={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText("已暂停")).toBeDefined();
    expect(screen.getByText("· 维护中")).toBeDefined();
    expect(screen.getByTestId("hud-resume")).toBeDefined();
    expect(screen.queryByTestId("hud-pause")).toBeNull();
  });

  it("renders pending-attention badges only when non-zero", () => {
    const { rerender } = render(
      <HUD
        summary={makeSummary({ tasks_needs_user: 0, confirmations_pending: 0 })}
        connection="open"
        onPauseRequest={vi.fn()}
        onResume={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.queryByText(/等你处理/)).toBeNull();
    expect(screen.queryByText(/待确认/)).toBeNull();

    rerender(
      <HUD
        summary={makeSummary({ tasks_needs_user: 3, confirmations_pending: 2 })}
        connection="open"
        onPauseRequest={vi.fn()}
        onResume={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText("3 等你处理")).toBeDefined();
    expect(screen.getByText("2 待确认")).toBeDefined();
  });

  it("refresh button calls onRefresh", () => {
    const onRefresh = vi.fn();
    render(
      <HUD
        summary={makeSummary()}
        connection="open"
        onPauseRequest={vi.fn()}
        onResume={vi.fn()}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByTestId("hud-refresh"));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
