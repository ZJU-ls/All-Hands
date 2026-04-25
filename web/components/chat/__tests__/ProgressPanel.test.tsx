/**
 * ADR 0019 · ProgressPanel + sections + hooks regression tests.
 *
 * Covers:
 *   - Whole-panel hide when no plan + no subagent
 *   - PlanProgressSection collapse/expand persists in localStorage
 *   - PlanProgressSection summary string (N/M · K running)
 *   - SubagentProgressSection derives from store · trace button visible
 *     only when result.run_id is present
 *   - useActiveSubagents tool-id matching covers both `dispatch_employee`
 *     short and `allhands.meta.dispatch_employee` long forms
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@/tests/test-utils/i18n-render";
import type { PlanLatestDto } from "@/lib/api";
import type { ToolCall } from "@/lib/protocol";
import { useChatStore } from "@/lib/store";
import { PlanProgressSection } from "../PlanProgressSection";
import { ProgressPanel } from "../ProgressPanel";
import { SubagentProgressSection } from "../SubagentProgressSection";

afterEach(cleanup);

beforeEach(() => {
  // Reset store + localStorage between tests so persisted expand state
  // and derived subagents start fresh.
  useChatStore.getState().reset();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

// next/navigation hooks need to be mocked inside vitest (no Next.js shell).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/chat/test",
  useSearchParams: () => new URLSearchParams(),
}));

// fetch mock for /plans/latest — defaults to "no plan" (null) so simple
// cases don't accidentally trigger the section.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockPlanFetch(plan: PlanLatestDto | null) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => plan,
  })) as unknown as typeof globalThis.fetch;
}

const PLAN_FIXTURE: PlanLatestDto = {
  plan_id: "p1",
  title: "Q3 发布计划",
  owner_employee_id: "emp-1",
  created_at: "2026-04-25T10:00:00Z",
  updated_at: "2026-04-25T10:05:00Z",
  steps: [
    { index: 0, title: "市场调研", status: "done", note: null },
    { index: 1, title: "价值点提炼", status: "done", note: null },
    { index: 2, title: "制定时间表", status: "running", note: null },
    { index: 3, title: "分发任务", status: "pending", note: null },
    { index: 4, title: "汇总结果", status: "pending", note: null },
  ],
};

function mkSubagent(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "tc_sub_1",
    tool_id: "allhands.meta.dispatch_employee",
    args: { employee_id: "onpm", task: "调研" },
    status: "running",
    result: undefined,
    ...overrides,
  } as ToolCall;
}

// --- ProgressPanel container ----------------------------------------------

describe("ProgressPanel · whole-panel hide", () => {
  it("renders nothing when no plan and no subagent", async () => {
    mockPlanFetch(null);
    render(<ProgressPanel conversationId="c1" />);
    // wait a tick for the debounced fetch to settle
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByTestId("progress-panel")).toBeNull();
  });
});

// --- PlanProgressSection --------------------------------------------------

describe("PlanProgressSection", () => {
  it("renders header summary N/M and 'running' chip", () => {
    render(<PlanProgressSection plan={PLAN_FIXTURE} />);
    const section = screen.getByTestId("plan-progress-section");
    expect(section.textContent).toContain("Q3 发布计划");
    expect(section.textContent).toContain("2/5");
    expect(section.textContent).toContain("1 进行中");
  });

  it("expands by default and renders all 5 step rows", () => {
    render(<PlanProgressSection plan={PLAN_FIXTURE} />);
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`plan-step-${i}`)).toBeTruthy();
    }
  });

  it("toggles via header click and persists collapsed state to localStorage", () => {
    render(<PlanProgressSection plan={PLAN_FIXTURE} />);
    const header = screen.getByTestId("plan-progress-section").querySelector("button")!;
    expect(screen.queryByTestId("plan-step-0")).toBeTruthy();
    fireEvent.click(header);
    expect(screen.queryByTestId("plan-step-0")).toBeNull();
    expect(window.localStorage.getItem("allhands.progress.plan.expanded")).toBe(
      "false",
    );
    fireEvent.click(header);
    expect(screen.queryByTestId("plan-step-0")).toBeTruthy();
    expect(window.localStorage.getItem("allhands.progress.plan.expanded")).toBe(
      "true",
    );
  });

  it("step status maps to data-status attribute (done / running / pending)", () => {
    render(<PlanProgressSection plan={PLAN_FIXTURE} />);
    expect(
      screen.getByTestId("plan-step-0").getAttribute("data-status"),
    ).toBe("done");
    expect(
      screen.getByTestId("plan-step-2").getAttribute("data-status"),
    ).toBe("running");
    expect(
      screen.getByTestId("plan-step-4").getAttribute("data-status"),
    ).toBe("pending");
  });
});

// --- SubagentProgressSection ----------------------------------------------

describe("SubagentProgressSection", () => {
  it("renders one row per subagent · running status reflected in data-status", () => {
    render(
      <SubagentProgressSection
        subagents={[
          {
            toolCallId: "tc1",
            name: "onpm",
            status: "running",
            startedAt: 0,
            runId: undefined,
          },
        ]}
      />,
    );
    const row = screen.getByTestId("subagent-row-tc1");
    expect(row).toBeTruthy();
    expect(row.getAttribute("data-status")).toBe("running");
  });

  it("trace button only renders when run_id present", () => {
    render(
      <SubagentProgressSection
        subagents={[
          {
            toolCallId: "tc1",
            name: "no-runid",
            status: "succeeded",
            startedAt: 0,
            runId: undefined,
          },
          {
            toolCallId: "tc2",
            name: "with-runid",
            status: "succeeded",
            startedAt: 0,
            runId: "run_abc123",
          },
        ]}
      />,
    );
    expect(screen.queryByTestId("subagent-trace-tc1")).toBeNull();
    expect(screen.getByTestId("subagent-trace-tc2")).toBeTruthy();
  });

  it("collapsed state persists to localStorage", () => {
    render(
      <SubagentProgressSection
        subagents={[
          {
            toolCallId: "tc1",
            name: "x",
            status: "running",
            startedAt: 0,
          },
        ]}
      />,
    );
    const header = screen
      .getByTestId("subagent-progress-section")
      .querySelector("button")!;
    fireEvent.click(header);
    expect(
      window.localStorage.getItem("allhands.progress.subagent.expanded"),
    ).toBe("false");
    expect(screen.queryByTestId("subagent-row-tc1")).toBeNull();
  });
});

// --- useActiveSubagents hook (via ProgressPanel integration) --------------

describe("ProgressPanel · subagent derived from store", () => {
  it("renders subagent section when a running dispatch_employee is in messages", async () => {
    mockPlanFetch(null);
    useChatStore.setState({
      messages: [
        {
          id: "m1",
          conversation_id: "c1",
          role: "assistant",
          content: "",
          tool_calls: [mkSubagent()],
          render_payloads: [],
          created_at: "2026-04-25T10:00:00Z",
        },
      ],
    });
    render(<ProgressPanel conversationId="c1" />);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByTestId("subagent-progress-section")).toBeTruthy();
    expect(screen.getByTestId("subagent-row-tc_sub_1")).toBeTruthy();
  });

  it("matches both short tool_id (dispatch_employee) and long allhands.meta form", async () => {
    mockPlanFetch(null);
    useChatStore.setState({
      messages: [
        {
          id: "m1",
          conversation_id: "c1",
          role: "assistant",
          content: "",
          tool_calls: [
            mkSubagent({ id: "short", tool_id: "dispatch_employee" }),
            mkSubagent({
              id: "long",
              tool_id: "allhands.meta.spawn_subagent",
            }),
          ],
          render_payloads: [],
          created_at: "2026-04-25T10:00:00Z",
        },
      ],
    });
    render(<ProgressPanel conversationId="c1" />);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByTestId("subagent-row-short")).toBeTruthy();
    expect(screen.getByTestId("subagent-row-long")).toBeTruthy();
  });
});
